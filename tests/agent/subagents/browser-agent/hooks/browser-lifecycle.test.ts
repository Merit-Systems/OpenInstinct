import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  deleteBrowserSession,
  listWorkerBrowserSessions,
} from "@db/services/browsers";
import type { disposeBrowserLoopSession } from "@agent/subagents/browser-agent/lib/semantic-loop";
import type { harvestBrowserTraceDomains } from "@agent/subagents/browser-agent/lib/trace/domains";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";
import lifecycle from "@agent/subagents/browser-agent/hooks/browser-lifecycle";
import { hookContextFor } from "@tests/helpers/hook-context";

const mocks = vi.hoisted(() => ({
  list: vi.fn<typeof listWorkerBrowserSessions>(),
  forget: vi.fn<typeof deleteBrowserSession>(),
  dispose: vi.fn<typeof disposeBrowserLoopSession>(),
  harvest: vi.fn<typeof harvestBrowserTraceDomains>(),
}));
vi.mock("@db/services/browsers", () => ({
  listWorkerBrowserSessions: mocks.list,
  deleteBrowserSession: mocks.forget,
}));
vi.mock("@agent/subagents/browser-agent/lib/semantic-loop", () => ({
  disposeBrowserLoopSession: mocks.dispose,
}));
vi.mock("@agent/subagents/browser-agent/lib/trace/domains", () => ({
  harvestBrowserTraceDomains: mocks.harvest,
}));
const release = vi.spyOn(kernel.browsers, "deleteByID");
const ended = lifecycle.events["session.ended"];
if (!ended)
  throw new Error("The worker must register terminal-session cleanup.");
const scope = { userId: "user-1", workspaceId: "workspace-1" };
const ctx = hookContextFor({
  sessionId: "worker-1",
  auth: {
    current: null,
    initiator: {
      principalId: scope.userId,
      principalType: "user",
      attributes: { workspaceId: scope.workspaceId },
      authenticator: "authjs",
    },
  },
});
const browser = { sessionId: "browser-1", createdAt: "2026-11-02T12:00:00Z" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([browser]);
  mocks.forget.mockResolvedValue(true);
  mocks.dispose.mockResolvedValue();
  mocks.harvest.mockResolvedValue();
  release.mockResolvedValue();
});

describe("worker browser retirement", () => {
  it.each(["completed", "failed"] as const)(
    "releases only this worker's browsers when the session ends %s",
    async (outcome) => {
      await ended({ type: "session.ended", data: { outcome } }, ctx);
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith(scope, "worker-1");
      expect(mocks.harvest).toHaveBeenCalledWith(
        scope,
        "worker-1",
        browser,
        expect.any(AbortSignal)
      );
      expect(release).toHaveBeenCalledOnce();
      expect(release.mock.calls[0]?.[0]).toBe("browser-1");
      expect(release.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(mocks.forget).toHaveBeenCalledExactlyOnceWith(scope, "browser-1");
      expect(release.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.forget.mock.invocationCallOrder[0] ?? 0
      );
    }
  );

  it("preserves a failed release for recovery while still retiring the other browsers", async () => {
    mocks.list.mockResolvedValue([
      browser,
      { ...browser, sessionId: "browser-2" },
    ]);
    release.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(
      ended({ type: "session.ended", data: { outcome: "completed" } }, ctx)
    ).rejects.toThrow("Some worker browsers could not be retired.");
    expect(mocks.forget).not.toHaveBeenCalledWith(scope, "browser-1");
    expect(mocks.forget).toHaveBeenCalledWith(scope, "browser-2");
  });

  it("forgets a browser that the provider confirms is already absent", async () => {
    release.mockRejectedValue({ status: 404 });
    await ended({ type: "session.ended", data: { outcome: "completed" } }, ctx);
    expect(mocks.forget).toHaveBeenCalledWith(scope, "browser-1");
  });

  it("does no provider work when a repeated retirement has no remaining browsers", async () => {
    mocks.list.mockResolvedValue([]);
    await ended({ type: "session.ended", data: { outcome: "completed" } }, ctx);
    expect(release).not.toHaveBeenCalled();
  });

  it("can retire a worker whose authenticated caller is current-only", async () => {
    await ended(
      { type: "session.ended", data: { outcome: "completed" } },
      {
        ...ctx,
        session: {
          ...ctx.session,
          auth: { initiator: null, current: ctx.session.auth.initiator },
        },
      }
    );
    expect(mocks.list).toHaveBeenCalledWith(scope, "worker-1");
    expect(mocks.forget).toHaveBeenCalledWith(scope, "browser-1");
  });

  it.each(["telemetry", "local disposal"] as const)(
    "reserves a live provider deadline when %s exhausts its budget",
    async (step) => {
      vi.useFakeTimers();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((milliseconds) => {
          const controller = new AbortController();
          setTimeout(() => {
            controller.abort();
          }, milliseconds);
          return controller.signal;
        });
      try {
        if (step === "telemetry") {
          mocks.harvest.mockImplementation(
            async (_scope, _worker, _browser, signal) => {
              if (!signal) throw new Error("Expected a telemetry deadline.");
              await new Promise<void>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    resolve();
                  },
                  { once: true }
                );
              });
            }
          );
        } else {
          mocks.dispose.mockImplementation(
            () => new Promise<void>(() => undefined)
          );
        }
        const work = ended(
          { type: "session.ended", data: { outcome: "completed" } },
          ctx
        );
        await vi.advanceTimersByTimeAsync(3_000);
        await work;
        expect(release).toHaveBeenCalledOnce();
        expect(release.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
        expect(mocks.forget).toHaveBeenCalledWith(scope, "browser-1");
      } finally {
        timeout.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it("uses a fresh cleanup signal after the runtime occurrence was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await ended(
      { type: "session.ended", data: { outcome: "completed" } },
      {
        ...ctx,
        occurrence: { ...ctx.occurrence, abortSignal: controller.signal },
      }
    );
    expect(release.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(mocks.forget).toHaveBeenCalledWith(scope, "browser-1");
  });
});

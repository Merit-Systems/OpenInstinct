import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  beginBrowserTrace,
  completeBrowserTrace,
} from "@/db/services/browser-traces";
import type { listWorkerBrowserSessions } from "@/db/services/browsers";
import type * as traceDomains from "@/agent/subagents/worker/lib/trace-domains";
import type { harvestBrowserTraceDomains } from "@/agent/subagents/worker/lib/trace-domains";

const mocks = vi.hoisted(() => ({
  beginBrowserTrace: vi.fn<typeof beginBrowserTrace>(),
  completeBrowserTrace: vi.fn<typeof completeBrowserTrace>(),
  harvestBrowserTraceDomains: vi.fn<typeof harvestBrowserTraceDomains>(),
  listWorkerBrowserSessions: vi.fn<typeof listWorkerBrowserSessions>(),
  recordBrowserTraceEvents:
    vi.fn<(scope: unknown, sessionId: string, events: unknown[]) => void>(),
}));

vi.mock("@/db/services/browser-traces", () => ({
  beginBrowserTrace: mocks.beginBrowserTrace,
  completeBrowserTrace: mocks.completeBrowserTrace,
  recordBrowserTraceEvents: mocks.recordBrowserTraceEvents,
}));

vi.mock("@/db/services/browsers", () => ({
  listWorkerBrowserSessions: mocks.listWorkerBrowserSessions,
}));

vi.mock("@/agent/subagents/worker/lib/trace-domains", () => ({
  harvestBrowserTraceDomains: mocks.harvestBrowserTraceDomains,
}));

import traceTelemetry from "../agent/subagents/worker/hooks/trace-telemetry";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context = {
  session: {
    auth: {
      initiator: {
        attributes: { workspaceId: scope.workspaceId },
        principalId: scope.userId,
      },
    },
    id: "worker-session-1",
  },
};

type TraceEvents = NonNullable<typeof traceTelemetry.events>;

async function fire(type: keyof TraceEvents, event: unknown) {
  const handler = traceTelemetry.events?.[type];
  expect(handler).toBeDefined();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- focused unit test supplies only the event and context fields each handler reads.
  await handler?.(event as never, context as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listWorkerBrowserSessions.mockResolvedValue([]);
});

describe("browser trace telemetry hook", () => {
  it("opens a running trace from the delegated task message", async () => {
    await fire("message.received", {
      data: { message: "Buy the blue mug on example.com" },
      meta: { at: "2026-08-31T00:00:00.000Z" },
    });

    expect(mocks.beginBrowserTrace).toHaveBeenCalledExactlyOnceWith(scope, {
      sessionId: "worker-session-1",
      startedAt: "2026-08-31T00:00:00.000Z",
      task: "Buy the blue mug on example.com",
    });
  });

  it("records the structured completion outcome and sweeps live browsers", async () => {
    mocks.listWorkerBrowserSessions.mockResolvedValue([
      { createdAt: "2026-08-31T00:00:01.000Z", sessionId: "browser-1" },
    ]);

    await fire("result.completed", {
      data: {
        result: { images: [], message: "Order placed.", status: "success" },
      },
      meta: { at: "2026-08-31T00:05:00.000Z" },
    });

    expect(mocks.completeBrowserTrace).toHaveBeenCalledExactlyOnceWith(
      scope,
      "worker-session-1",
      {
        completedAt: "2026-08-31T00:05:00.000Z",
        resultMessage: "Order placed.",
        status: "success",
      }
    );
    expect(mocks.harvestBrowserTraceDomains).toHaveBeenCalledExactlyOnceWith(
      scope,
      "worker-session-1",
      { createdAt: "2026-08-31T00:00:01.000Z", sessionId: "browser-1" }
    );
  });

  it("ignores structured results that are not task completions", async () => {
    await fire("result.completed", {
      data: { result: { unrelated: true } },
      meta: { at: "2026-08-31T00:05:00.000Z" },
    });

    expect(mocks.completeBrowserTrace).not.toHaveBeenCalled();
  });

  it("marks infrastructure failures and cancellations distinctly", async () => {
    await fire("turn.failed", {
      data: { code: "model_error", message: "The model call failed." },
      meta: { at: "2026-08-31T00:06:00.000Z" },
    });
    await fire("turn.cancelled", {
      data: {},
      meta: { at: "2026-08-31T00:07:00.000Z" },
    });

    expect(mocks.completeBrowserTrace).toHaveBeenNthCalledWith(
      1,
      scope,
      "worker-session-1",
      {
        completedAt: "2026-08-31T00:06:00.000Z",
        resultMessage: "The model call failed.",
        status: "error",
      }
    );
    expect(mocks.completeBrowserTrace).toHaveBeenNthCalledWith(
      2,
      scope,
      "worker-session-1",
      {
        completedAt: "2026-08-31T00:07:00.000Z",
        resultMessage: undefined,
        status: "cancelled",
      }
    );
  });

  it("never throws telemetry failures back into the turn", async () => {
    mocks.beginBrowserTrace.mockRejectedValue(new Error("database offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      fire("message.received", {
        data: { message: "task" },
        meta: { at: "2026-08-31T00:00:00.000Z" },
      })
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("trace event persistence", () => {
  it("summarizes stream events into single-line timeline rows", async () => {
    await fire("*", {
      data: {
        actions: [
          {
            callId: "call-1",
            input: { session_id: "browser-1" },
            kind: "tool-call",
            toolName: "manage_browsers",
          },
        ],
        sequence: 0,
        stepIndex: 0,
        turnId: "turn_0",
      },
      meta: { at: "2026-08-31T00:00:02.000Z", id: "evt_01" },
      type: "actions.requested",
    });

    expect(mocks.recordBrowserTraceEvents).toHaveBeenCalledExactlyOnceWith(
      scope,
      "worker-session-1",
      [
        {
          at: "2026-08-31T00:00:02.000Z",
          detail: '{"session_id":"browser-1"}',
          id: "evt_01:0",
          label: "manage_browsers",
          type: "actions.requested",
        },
      ]
    );
  });

  it("compacts oversized payloads before persisting", async () => {
    await fire("*", {
      data: {
        result: {
          callId: "call-2",
          kind: "tool-result",
          output: { screenshotBase64: "x".repeat(50_000) },
          toolName: "computer_action",
        },
        sequence: 1,
        status: "completed",
        stepIndex: 0,
        turnId: "turn_0",
      },
      meta: { at: "2026-08-31T00:00:03.000Z", id: "evt_02" },
      type: "action.result",
    });

    const [, , events] = mocks.recordBrowserTraceEvents.mock.calls[0] ?? [];
    const detail = z
      .array(z.object({ detail: z.string(), label: z.string() }))
      .parse(events)[0];
    expect(detail?.label).toBe("computer_action → result");
    expect(detail?.detail.length).toBeLessThanOrEqual(601);
  });
});

describe("trace domain extraction", () => {
  it("keeps only http(s) hostnames", async () => {
    const { domainFromUrl } = await vi.importActual<typeof traceDomains>(
      "@/agent/subagents/worker/lib/trace-domains"
    );

    expect(domainFromUrl("https://shop.example.com/cart?item=1")).toBe(
      "shop.example.com"
    );
    expect(domainFromUrl("http://example.com")).toBe("example.com");
    expect(
      domainFromUrl("chrome-extension://abcdef/page.html")
    ).toBeUndefined();
    expect(domainFromUrl("about:blank")).toBeUndefined();
    expect(domainFromUrl("not a url")).toBeUndefined();
  });
});

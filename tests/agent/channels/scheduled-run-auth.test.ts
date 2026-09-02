import type {
  ChannelResolveSession,
  ChannelSource,
  RouteHandlerArgs,
  Session,
} from "eve/channels";
import { describe, expect, it, vi } from "vitest";
import scheduledRunChannel from "@/agent/channels/scheduled-run";

const scheduledRunPaths = [
  "/internal/scheduled-run/report",
  "/internal/scheduled-run/respond",
] as const;

describe("scheduled run channel authentication", () => {
  for (const path of scheduledRunPaths) {
    it(`rejects an unauthenticated request to ${path}`, async () => {
      const route = scheduledRunChannel.routes.find(
        (candidate) =>
          candidate.transport !== "websocket" &&
          candidate.method === "POST" &&
          candidate.path === path
      );
      if (!route || route.transport === "websocket") {
        throw new Error(`The scheduled run route ${path} is unavailable.`);
      }

      const response = await route.handler(
        new Request(`https://assistant.example${path}`, {
          body: "not valid JSON",
          method: "POST",
        }),
        unexpectedRouteContext()
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    });
  }
});

describe("scheduled run channel handoff", () => {
  it("starts a scheduled worker from the channel's native receive hook", async () => {
    const send = vi
      .fn<ChannelSource["send"]>()
      .mockResolvedValue(workerSession());
    const reset = vi.fn<ChannelSource["reset"]>();
    const source: ChannelSource = {
      cancel: vi.fn<ChannelSource["cancel"]>(),
      clear: vi.fn<ChannelSource["clear"]>(),
      compact: vi.fn<ChannelSource["compact"]>(),
      reset,
      respond: vi.fn<ChannelSource["respond"]>(),
      send,
    };
    const from = vi.fn<(address: string) => ChannelSource>(() => source);
    const receive = scheduledRunChannel.receive;
    if (!receive) throw new Error("The scheduled-run channel cannot receive.");
    const auth = {
      attributes: { scheduledRunId: "00000000-0000-4000-8000-000000000001" },
      authenticator: "scheduled-worker",
      principalId: "user-1",
      principalType: "user" as const,
    };

    const result = await receive(
      {
        auth,
        message: "Run the scheduled task.",
        target: {
          restart: true,
          runId: "00000000-0000-4000-8000-000000000001",
        },
      },
      {
        from,
        resolveSession: vi
          .fn<ChannelResolveSession>()
          .mockResolvedValue(undefined),
      }
    );

    expect(from).toHaveBeenCalledExactlyOnceWith(
      "scheduled-run:00000000-0000-4000-8000-000000000001"
    );
    expect(reset).toHaveBeenCalledExactlyOnceWith({
      reason: "Scheduled worker exceeded its runtime.",
    });
    expect(send).toHaveBeenCalledWith(
      "Run the scheduled task.",
      expect.objectContaining({
        auth,
        title: "Scheduled run 00000000-0000-4000-8000-000000000001",
      })
    );
    expect(result.id).toBe("worker-session");
  });
});

function unexpectedRouteContext() {
  return {
    attachSession: unexpectedRouteRequest,
    from: unexpectedRouteRequest,
    params: {},
    requestIp: null,
    resolveSession: unexpectedRouteRequest,
    to: unexpectedRouteRequest,
    waitUntil: unexpectedRouteRequest,
  } satisfies RouteHandlerArgs;
}

function unexpectedRouteRequest(): never {
  throw new Error("The request should stop at authentication.");
}

function workerSession(): Session {
  return {
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    id: "worker-session",
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
  };
}

import type { RouteHandlerArgs, Session } from "eve/channels";
import { routeAuth } from "eve/channels/auth";
import type * as ChannelAuth from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { listMemorySessionBindings } from "@db/services/memory/scope";
import type { recordMemoryRecovery } from "@db/services/memory/sources";

const mocks = vi.hoisted(() => ({
  bindings: vi.fn<typeof listMemorySessionBindings>(),
  recover: vi.fn<typeof recordMemoryRecovery>(),
  mode: "enabled",
}));
vi.mock("@db/services/memory/scope", () => ({
  listMemorySessionBindings: mocks.bindings,
}));
vi.mock("@db/services/memory/sources", () => ({
  recordMemoryRecovery: mocks.recover,
}));
vi.mock("@shared/environment", () => ({
  env: {
    get KNOWLEDGE_MEMORY_MODE() {
      return mocks.mode;
    },
  },
}));
vi.mock("eve/channels/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof ChannelAuth>();
  return { ...actual, routeAuth: vi.fn<typeof routeAuth>(actual.routeAuth) };
});

import channel from "@agent/channels/memory-maintenance";

const route = channel.routes.find(
  (candidate) => candidate.transport !== "websocket"
);
const binding = {
  scope: { workspaceId: "workspace", userId: "user" },
  workspaceId: "workspace",
  userId: "user",
  sessionId: "session",
  scopeKey: "key",
  namespace: "namespace",
  cursor: 0,
  captureAfter: new Date("2026-10-21T11:59:00.000Z"),
  captureDisabled: false,
  updatedAt: new Date(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof ChannelAuth>("eve/channels/auth");
  vi.mocked(routeAuth).mockImplementation(actual.routeAuth);
  mocks.mode = "enabled";
  mocks.bindings.mockResolvedValue([binding]);
  mocks.recover.mockResolvedValue({ cursor: 1, captured: 1 });
});

async function request(
  events: MessageStreamEvent[],
  body: Record<string, string> = {}
) {
  if (!route) throw new Error("Recovery route unavailable.");
  const session = {
    id: "session",
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
    getStreamTailIndex: vi
      .fn<Session["getStreamTailIndex"]>()
      .mockResolvedValue(events.length - 1),
    getEventStream: vi.fn<Session["getEventStream"]>().mockResolvedValue(
      new ReadableStream<MessageStreamEvent>({
        start(controller) {
          for (const event of events) controller.enqueue(event);
          controller.close();
        },
      })
    ),
  };
  const context = {
    attachSession: vi.fn<RouteHandlerArgs["attachSession"]>(() => session),
    from: vi.fn<RouteHandlerArgs["from"]>(),
    resolveSession: vi.fn<RouteHandlerArgs["resolveSession"]>(),
    to: vi.fn<RouteHandlerArgs["to"]>(),
    waitUntil: vi.fn<RouteHandlerArgs["waitUntil"]>(),
    params: {},
    requestIp: null,
  } satisfies RouteHandlerArgs;
  const response = await route.handler(
    new Request("https://example.com/internal/memory-maintenance/recover", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context
  );
  return { response, context, session };
}

function authenticate() {
  vi.mocked(routeAuth).mockResolvedValue({
    authenticator: "internal-test",
    principalId: "maintenance",
    principalType: "service",
    attributes: {},
  });
}

function userMessage(message: string, turnId = "turn"): MessageStreamEvent {
  return {
    type: "message.received",
    data: { message, turnId, sequence: 0 },
    meta: { id: `event-${turnId}`, at: "2026-10-21T12:00:00.000Z" },
  };
}

describe("knowledge memory recovery route", () => {
  it("rejects unauthenticated requests before looking up sessions", async () => {
    const { response, context } = await request([]);
    expect(response.status).toBe(401);
    expect(mocks.bindings).not.toHaveBeenCalled();
    expect(context.attachSession).not.toHaveBeenCalled();
  });

  it("does no work when disabled and does not accept client-selected sessions", async () => {
    authenticate();
    expect((await request([], { sessionId: "foreign" })).response.status).toBe(
      400
    );
    mocks.mode = "off";
    expect((await request([])).response.status).toBe(200);
    expect(mocks.bindings).not.toHaveBeenCalled();
  });

  it("recovers missed direct input while excluding secrets and generated events", async () => {
    authenticate();
    const generated = userMessage("I like sports", "generated");
    if (generated.type !== "message.received")
      throw new Error("Unexpected event.");
    generated.data.kind = "execution.background_task";
    const { response, session } = await request([
      userMessage("I prefer quiet train cars."),
      userMessage("My password is unsafe", "secret"),
      generated,
    ]);
    expect(response.status).toBe(200);
    expect(session.getEventStream).toHaveBeenCalledWith({ startIndex: 0 });
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({
        expectedCursor: 0,
        nextCursor: 3,
        sources: [
          expect.objectContaining({
            text: "I prefer quiet train cars.",
            sessionId: "session",
            turnId: "turn",
          }),
        ],
      })
    );
  });

  it("does not capture from sessions previously marked sensitive", async () => {
    authenticate();
    mocks.bindings.mockResolvedValue([{ ...binding, captureDisabled: true }]);
    await request([userMessage("MangoTreeIsMySecret")]);
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({ sources: [], captureBoundaries: [] })
    );
  });

  it("advances past history from before memory was enabled without capturing it", async () => {
    authenticate();
    const earlier = {
      ...userMessage("I used to live in Paris.", "earlier"),
      meta: { id: "event-earlier", at: "2026-10-20T12:00:00.000Z" },
    };
    await request([earlier, userMessage("I prefer quiet trains.")]);
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({
        nextCursor: 2,
        captureBoundaries: [],
        sources: [expect.objectContaining({ text: "I prefer quiet trains." })],
      })
    );
  });

  it("touches caught-up sessions so the next maintenance batch can make progress", async () => {
    authenticate();
    const { session } = await request([]);
    expect(session.getEventStream).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({ expectedCursor: 0, nextCursor: 0, sources: [] })
    );
  });

  it("honors an older sensitive-input boundary without importing old text", async () => {
    authenticate();
    await request([
      {
        type: "input.requested",
        data: { requests: [], sequence: 0, stepIndex: 0, turnId: "earlier" },
        meta: { id: "old-input", at: "2026-10-20T12:00:00.000Z" },
      },
      userMessage("My response to the earlier request"),
    ]);
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({
        nextCursor: 2,
        sources: [],
        captureBoundaries: [
          { turnId: "earlier", observedAt: "2026-10-20T12:00:00.000Z" },
        ],
      })
    );
  });

  it("repairs each original boundary even after live capture was disabled", async () => {
    authenticate();
    mocks.bindings.mockResolvedValue([{ ...binding, captureDisabled: true }]);
    await request([
      {
        type: "input.requested",
        data: { requests: [], sequence: 0, stepIndex: 0, turnId: "question" },
        meta: { id: "question", at: "2026-10-21T12:01:00.000Z" },
      },
      {
        type: "authorization.required",
        data: {
          name: "connection",
          description: "Authorize connection",
          sequence: 1,
          stepIndex: 0,
          turnId: "authorization",
        },
        meta: { id: "authorization", at: "2026-10-21T12:02:00.000Z" },
      },
    ]);
    expect(mocks.recover).toHaveBeenCalledWith(
      binding.scope,
      "key",
      "session",
      expect.objectContaining({
        sources: [],
        captureBoundaries: [
          { turnId: "question", observedAt: "2026-10-21T12:01:00.000Z" },
          { turnId: "authorization", observedAt: "2026-10-21T12:02:00.000Z" },
        ],
      })
    );
  });

  it("reports failed durable commits for retry", async () => {
    authenticate();
    mocks.recover.mockRejectedValue(new Error("Database unavailable"));
    const { response } = await request([userMessage("I like trains")]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ scanned: 0, failed: 1 });
  });

  it.each([
    {
      type: "turn.completed",
      data: { sequence: 0, turnId: "turn" },
      meta: { id: "completed", at: "2026-10-21T12:01:00.000Z" },
    },
    {
      type: "turn.failed",
      data: {
        sequence: 0,
        turnId: "turn",
        code: "MODEL_FAILURE",
        message: "The turn failed.",
      },
      meta: { id: "failed", at: "2026-10-21T12:01:00.000Z" },
    },
    {
      type: "turn.cancelled",
      data: { sequence: 0, turnId: "turn" },
      meta: { id: "cancelled", at: "2026-10-21T12:01:00.000Z" },
    },
  ] satisfies MessageStreamEvent[])(
    "repairs unused control cleanup after $type",
    async (event) => {
      authenticate();
      await request([userMessage("Please update the spreadsheet."), event]);
      expect(mocks.recover).toHaveBeenCalledWith(
        binding.scope,
        "key",
        "session",
        expect.objectContaining({ finishedTurnIds: ["turn"] })
      );
    }
  );
});

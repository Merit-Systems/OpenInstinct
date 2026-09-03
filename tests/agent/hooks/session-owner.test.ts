import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookContext } from "eve/hooks";
import type { saveChat } from "@/db/services/chats";
import sessionOwner from "@/agent/hooks/session-owner";

const mocks = vi.hoisted(() => ({
  saveChat: vi.fn<typeof saveChat>(),
}));

vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));

type MessageReceivedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["message.received"]
>;

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context = {
  agent: { name: "test-agent" },
  channel: { kind: "channel:linq" },
  async getSandbox() {
    throw new Error("Sandbox access is outside this focused test.");
  },
  getSkill() {
    throw new Error("Skill access is outside this focused test.");
  },
  session: {
    auth: {
      current: null,
      initiator: {
        attributes: { workspaceId: scope.workspaceId },
        authenticator: "test",
        principalId: scope.userId,
        principalType: "user",
      },
    },
    id: "session-1",
    turn: { id: "turn-1", sequence: 0 },
  },
} satisfies HookContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveChat.mockResolvedValue();
});

describe("session ownership hook", () => {
  it("indexes messages received outside the web chat client", async () => {
    const handler = sessionOwner.events?.["message.received"];
    expect(handler).toBeDefined();

    const event = {
      data: { message: "hello", sequence: 0, turnId: "turn-1" },
      meta: {
        at: "2026-08-31T00:00:00.000Z",
        id: "event-1",
      },
      type: "message.received",
    } satisfies Parameters<MessageReceivedHandler>[0];
    await handler?.(event, context);

    expect(mocks.saveChat).toHaveBeenCalledWith(scope, {
      channel: "linq",
      sessionId: "session-1",
    });
  });

  it("records the web channel for HTTP messages", async () => {
    const handler = sessionOwner.events?.["message.received"];
    const event = {
      data: { message: "hello", sequence: 0, turnId: "turn-1" },
      meta: {
        at: "2026-08-31T00:00:00.000Z",
        id: "event-1",
      },
      type: "message.received",
    } satisfies Parameters<MessageReceivedHandler>[0];
    await handler?.(event, {
      ...context,
      channel: { kind: "http" },
    });

    expect(mocks.saveChat).toHaveBeenCalledWith(scope, {
      channel: "eve",
      sessionId: "session-1",
    });
  });
});

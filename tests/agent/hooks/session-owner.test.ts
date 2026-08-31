import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookContext } from "eve/hooks";
import sessionOwner, {
  sessionOwnerDependencies,
} from "@/agent/hooks/session-owner";

const saveChatMock = vi.spyOn(sessionOwnerDependencies, "saveChat");

type MessageReceivedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["message.received"]
>;

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context = {
  agent: { name: "test-agent" },
  channel: {},
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
  saveChatMock.mockResolvedValue();
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

    expect(saveChatMock).toHaveBeenCalledWith(scope, {
      sessionId: "session-1",
    });
  });
});

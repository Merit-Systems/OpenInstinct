import { beforeEach, describe, expect, it, vi } from "vitest";
import type { saveChat } from "@/db/services/chats";
import type { ensureScope } from "@/db/services/scope";
import type { claimSession } from "@/db/services/sessions";

const mocks = vi.hoisted(() => ({
  claimSession: vi.fn<typeof claimSession>(),
  ensureScope: vi.fn<typeof ensureScope>(),
  saveChat: vi.fn<typeof saveChat>(),
}));

vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));
vi.mock("@/db/services/scope", () => ({ ensureScope: mocks.ensureScope }));
vi.mock("@/db/services/sessions", () => ({
  claimSession: mocks.claimSession,
}));

import sessionOwner from "../agent/hooks/session-owner";

type MessageReceivedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["message.received"]
>;

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context = {
  session: {
    auth: {
      initiator: {
        attributes: { workspaceId: scope.workspaceId },
        principalId: scope.userId,
      },
    },
    id: "session-1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("session ownership hook", () => {
  it("indexes messages received outside the web chat client", async () => {
    const handler = sessionOwner.events?.["message.received"];
    expect(handler).toBeDefined();

    // The handler only reads session identity; the event payload and remaining
    // runtime services are intentionally omitted from this focused unit test.
    // oxlint-disable typescript/no-unsafe-type-assertion -- The handler only
    // reads the fields supplied by this focused unit test.
    const event = {} as Parameters<MessageReceivedHandler>[0];
    const hookContext =
      context as unknown as Parameters<MessageReceivedHandler>[1];
    // oxlint-enable typescript/no-unsafe-type-assertion
    await handler?.(event, hookContext);

    expect(mocks.saveChat).toHaveBeenCalledWith(scope, {
      sessionId: "session-1",
    });
  });
});

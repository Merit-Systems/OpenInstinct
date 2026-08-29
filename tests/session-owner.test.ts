import { beforeEach, describe, expect, it, vi } from "vitest";
import type { saveChat } from "@/db/services/chats";
import type { ensureScope } from "@/db/services/scope";
import type { claimSession } from "@/db/services/sessions";
import type { checkBudget, recordUsageEvent } from "@/db/services/usage";

const mocks = vi.hoisted(() => ({
  claimSession: vi.fn<typeof claimSession>(),
  ensureScope: vi.fn<typeof ensureScope>(),
  saveChat: vi.fn<typeof saveChat>(),
  checkBudget: vi.fn<typeof checkBudget>(),
  recordUsageEvent: vi.fn<typeof recordUsageEvent>(),
}));

vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));
vi.mock("@/db/services/scope", () => ({ ensureScope: mocks.ensureScope }));
vi.mock("@/db/services/sessions", () => ({
  claimSession: mocks.claimSession,
}));
vi.mock("@/db/services/usage", () => ({
  checkBudget: mocks.checkBudget,
  recordUsageEvent: mocks.recordUsageEvent,
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
  mocks.checkBudget.mockResolvedValue(undefined);
  mocks.recordUsageEvent.mockResolvedValue(undefined);
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

  it("records each completed model step once for every channel session", async () => {
    const handler = sessionOwner.events?.["step.completed"];
    expect(handler).toBeDefined();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Focused event fixture.
    const event = {
      data: {
        stepIndex: 2,
        turnId: "turn-1",
        usage: { costUsd: 0.02, inputTokens: 250, outputTokens: 150 },
      },
    } as Parameters<NonNullable<typeof handler>>[0];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Focused hook context fixture.
    const hookContext = context as unknown as Parameters<
      NonNullable<typeof handler>
    >[1];

    await handler?.(event, hookContext);
    await Promise.resolve();

    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(scope, {
      costEstimateUsd: 0.02,
      kind: "model_tokens",
      metadata: { stepIndex: 2, turnId: "turn-1" },
      quantity: 400,
      sessionId: "session-1",
      unit: "tokens",
    });
  });
});

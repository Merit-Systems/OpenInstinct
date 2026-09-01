import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookContext } from "eve/hooks";
import type { saveChat } from "@/db/services/chats";
import type { ensureScope } from "@/db/services/scope";
import type { claimSession } from "@/db/services/sessions";
import type { checkBudget, recordUsageEvent } from "@/db/services/usage";
import sessionOwner from "@/agent/hooks/session-owner";

const mocks = vi.hoisted(() => ({
  checkBudget: vi.fn<typeof checkBudget>(),
  claimSession: vi.fn<typeof claimSession>(),
  ensureScope: vi.fn<typeof ensureScope>(),
  recordUsageEvent: vi.fn<typeof recordUsageEvent>(),
  saveChat: vi.fn<typeof saveChat>(),
}));

vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));
vi.mock("@/db/services/scope", () => ({ ensureScope: mocks.ensureScope }));
vi.mock("@/db/services/sessions", () => ({ claimSession: mocks.claimSession }));
vi.mock("@/db/services/usage", () => ({
  checkBudget: mocks.checkBudget,
  recordUsageEvent: mocks.recordUsageEvent,
}));

type MessageReceivedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["message.received"]
>;
type StepCompletedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["step.completed"]
>;
type TurnStartedHandler = NonNullable<
  NonNullable<typeof sessionOwner.events>["turn.started"]
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
  mocks.checkBudget.mockResolvedValue(undefined);
  mocks.recordUsageEvent.mockResolvedValue(undefined);
  mocks.saveChat.mockResolvedValue();
});

describe("session ownership hook", () => {
  it("indexes messages received outside the web chat client", async () => {
    const handler = sessionOwner.events?.["message.received"];
    expect(handler).toBeDefined();
    const event = {
      data: { message: "hello", sequence: 0, turnId: "turn-1" },
      meta: { at: "2026-08-31T00:00:00.000Z", id: "event-1" },
      type: "message.received",
    } satisfies Parameters<MessageReceivedHandler>[0];

    await handler?.(event, context);

    expect(mocks.saveChat).toHaveBeenCalledWith(scope, {
      sessionId: "session-1",
    });
  });

  it("records each completed model step once for every channel session", async () => {
    const handler = sessionOwner.events?.["step.completed"];
    expect(handler).toBeDefined();
    const event = {
      data: {
        finishReason: "stop",
        sequence: 2,
        stepIndex: 2,
        turnId: "turn-1",
        usage: { costUsd: 0.02, inputTokens: 250, outputTokens: 150 },
      },
      meta: { at: "2026-08-31T00:00:00.000Z", id: "event-2" },
      type: "step.completed",
    } satisfies Parameters<StepCompletedHandler>[0];

    await handler?.(event, context);
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

  it("denies a model turn when the workspace is not operable", async () => {
    const handler = sessionOwner.events?.["turn.started"];
    expect(handler).toBeDefined();
    const error = new Error("workspace is not operable");
    mocks.checkBudget.mockRejectedValue(error);
    const event = {
      data: { sequence: 0, turnId: "turn-1" },
      meta: { at: "2026-08-31T00:00:00.000Z", id: "event-3" },
      type: "turn.started",
    } satisfies Parameters<TurnStartedHandler>[0];

    await expect(handler?.(event, context)).rejects.toBe(error);
    expect(mocks.checkBudget).toHaveBeenCalledWith(scope, "model_tokens");
  });
});

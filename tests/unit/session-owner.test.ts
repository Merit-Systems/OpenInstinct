import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionOwnerHandlers,
  sessionOwnerDependencies,
  type SessionOwnerContext,
} from "../../agent/hooks/session-owner";

const checkBudget = vi.fn<typeof sessionOwnerDependencies.checkBudget>();
const claimSession = vi.fn<typeof sessionOwnerDependencies.claimSession>();
const ensureScope = vi.fn<typeof sessionOwnerDependencies.ensureScope>();
const recordUsageEvent =
  vi.fn<typeof sessionOwnerDependencies.recordUsageEvent>();
const saveChat = vi.fn<typeof sessionOwnerDependencies.saveChat>();
const originalDependencies = { ...sessionOwnerDependencies };

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const context: SessionOwnerContext = { scope, sessionId: "session-1" };
const handlers = createSessionOwnerHandlers();

beforeEach(() => {
  vi.clearAllMocks();
  checkBudget.mockResolvedValue(undefined);
  recordUsageEvent.mockResolvedValue(undefined);
  Object.assign(sessionOwnerDependencies, {
    checkBudget,
    claimSession,
    ensureScope,
    recordUsageEvent,
    saveChat,
  });
});

afterEach(() => {
  Object.assign(sessionOwnerDependencies, originalDependencies);
});

describe("session ownership hook", () => {
  it("indexes messages received outside the web chat client", async () => {
    await handlers.messageReceived(context);

    expect(saveChat).toHaveBeenCalledWith(scope, {
      sessionId: "session-1",
    });
  });

  it("records each completed model step once for every channel session", async () => {
    const event = {
      data: {
        stepIndex: 2,
        turnId: "turn-1",
        usage: { costUsd: 0.02, inputTokens: 250, outputTokens: 150 },
      },
    };

    await handlers.stepCompleted(event, context);
    await Promise.resolve();

    expect(recordUsageEvent).toHaveBeenCalledWith(scope, {
      costEstimateUsd: 0.02,
      kind: "model_tokens",
      metadata: { stepIndex: 2, turnId: "turn-1" },
      quantity: 400,
      sessionId: "session-1",
      unit: "tokens",
    });
  });

  it("denies a model turn when the workspace is not operable", async () => {
    const error = new Error("workspace is not operable");
    checkBudget.mockRejectedValue(error);

    await expect(handlers.turnStarted(context)).rejects.toBe(error);
    expect(checkBudget).toHaveBeenCalledWith(scope, "model_tokens");
  });
});

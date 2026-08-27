import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { combineChatUsage, summarizeChatUsage } from "../app/_lib/chat-usage";

describe("chat usage", () => {
  it("sums token and complete cost usage across model steps", () => {
    expect(
      summarizeChatUsage([
        completedStep("event-1", 1200, 300, 0.012),
        completedStep("event-2", 800, 200, 0.008),
      ])
    ).toEqual({ costUsd: 0.02, inputTokens: 2000, outputTokens: 500 });
  });

  it("does not present a partial model cost as the chat total", () => {
    expect(
      summarizeChatUsage([
        completedStep("event-1", 1200, 300, 0.012),
        completedStep("event-2", 800, 200),
      ])
    ).toEqual({ costUsd: null, inputTokens: 2000, outputTokens: 500 });
  });

  it("combines persisted chat summaries for the global view", () => {
    expect(
      combineChatUsage([
        { costUsd: 0.012, inputTokens: 1200, outputTokens: 300 },
        { costUsd: 0.008, inputTokens: 800, outputTokens: 200 },
      ])
    ).toEqual({ costUsd: 0.02, inputTokens: 2000, outputTokens: 500 });
  });

  it("does not present a partial cost as the global total", () => {
    expect(
      combineChatUsage([
        { costUsd: 0.012, inputTokens: 1200, outputTokens: 300 },
        { costUsd: null, inputTokens: 800, outputTokens: 200 },
      ])
    ).toEqual({ costUsd: null, inputTokens: 2000, outputTokens: 500 });
  });
});

function completedStep(
  id: string,
  inputTokens: number,
  outputTokens: number,
  costUsd?: number
): MessageStreamEvent {
  return {
    data: {
      finishReason: "stop",
      sequence: 1,
      stepIndex: 0,
      turnId: "turn-1",
      usage: { costUsd, inputTokens, outputTokens },
    },
    meta: { at: "2026-08-26T00:00:00.000Z", id },
    type: "step.completed",
  };
}

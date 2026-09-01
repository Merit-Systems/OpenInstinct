import type { MessageStreamEvent } from "eve/client";
import type { ChatUsage } from "@/lib/chat";

export function summarizeChatUsage(
  events: readonly MessageStreamEvent[]
): ChatUsage {
  let costUsd = 0;
  let completedSteps = 0;
  let measuredCosts = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    if (event.type !== "step.completed") continue;
    completedSteps += 1;

    inputTokens += event.data.usage?.inputTokens ?? 0;
    outputTokens += event.data.usage?.outputTokens ?? 0;
    if (event.data.usage?.costUsd !== undefined) {
      costUsd += event.data.usage.costUsd;
      measuredCosts += 1;
    }
  }

  return {
    costUsd:
      completedSteps > 0 && measuredCosts === completedSteps ? costUsd : null,
    inputTokens,
    outputTokens,
  };
}

export function combineChatUsage(usages: readonly ChatUsage[]): ChatUsage {
  let costUsd = 0;
  let hasMeasuredCost = false;
  let hasUnmeasuredUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const usage of usages) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;

    if (usage.costUsd === null) {
      hasUnmeasuredUsage ||= usage.inputTokens + usage.outputTokens > 0;
    } else {
      costUsd += usage.costUsd;
      hasMeasuredCost = true;
    }
  }

  return {
    costUsd: hasMeasuredCost && !hasUnmeasuredUsage ? costUsd : null,
    inputTokens,
    outputTokens,
  };
}

export function formatChatUsage(usage: ChatUsage) {
  const tokens = usage.inputTokens + usage.outputTokens;
  const tokenLabel = `${new Intl.NumberFormat("en", {
    notation: tokens >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(tokens)} tokens`;

  if (usage.costUsd === null) return tokenLabel;

  const costLabel = new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: usage.costUsd < 0.01 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(usage.costUsd);

  return `${tokenLabel} · ${costLabel}`;
}

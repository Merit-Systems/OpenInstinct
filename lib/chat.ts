import type { MessageStreamEvent } from "eve/client";
import { z } from "zod";

const chatUsageSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

const chatSummarySchema = z.object({
  createdAt: z.string(),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string(),
  usage: chatUsageSchema,
});

export const chatListSchema = z.array(chatSummarySchema);

export const saveChatSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().trim().min(1).max(240).optional(),
  usage: chatUsageSchema.optional(),
});

export type ChatUsage = z.infer<typeof chatUsageSchema>;
export type ChatSummary = z.infer<typeof chatSummarySchema>;
export type SaveChat = z.infer<typeof saveChatSchema>;

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

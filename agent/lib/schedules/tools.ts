import type { ToolContext } from "eve/tools";
import { z } from "zod";
import type { listScheduledAgentJobs } from "@/db/services/scheduled-agent-jobs";
import { scopeFromPrincipal } from "@/lib/access-scope";

export function scheduleOwner(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") {
    throw new Error("An authenticated user is required to manage schedules.");
  }
  const conversationChannel = z
    .enum(["eve", "linq"])
    .parse(auth.attributes.conversationChannel);
  const conversationId =
    conversationChannel === "eve"
      ? context.session.id
      : z.string().startsWith("linq:").parse(auth.attributes.conversationId);
  return {
    conversation: { conversationChannel, conversationId },
    scope: scopeFromPrincipal(auth),
  };
}

export function scheduleSummary(
  job: Awaited<ReturnType<typeof listScheduledAgentJobs>>[number]
) {
  return {
    createdAt: job.createdAt.toISOString(),
    id: job.id,
    lastError: job.lastError,
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    prompt: job.prompt,
    status: job.status,
    timing: job.timing,
  };
}

import type { ToolContext } from "eve/tools";
import { z } from "zod";
import type {
  createScheduledAgentJob,
  listScheduledAgentJobs,
} from "@db/services/scheduled-agent-jobs";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";

export function scheduleOwner(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") {
    throw new Error("An authenticated user is required to manage schedules.");
  }
  const conversationChannel = z
    .enum(["blooio", "eve", "linq"])
    .parse(auth.attributes.conversationChannel);
  const conversationId =
    conversationChannel === "eve"
      ? context.session.id
      : z
          .string()
          .startsWith(`${conversationChannel}:`)
          .parse(auth.attributes.conversationId);
  return {
    conversation: { conversationChannel, conversationId },
    scope: scopeFromPrincipal(auth),
  };
}

export function scheduleReplyAnchor(context: ToolContext) {
  const auth = context.session.auth.current;
  const channel = auth?.attributes.conversationChannel;
  if (channel !== "linq" && channel !== "blooio") return undefined;
  const messageId = z
    .string()
    .min(1)
    .safeParse(
      channel === "linq"
        ? auth?.attributes.linqMessageId
        : auth?.attributes.blooioMessageId
    );
  return messageId.success ? messageId.data : undefined;
}

export function scheduleSummary(
  job: Awaited<ReturnType<typeof createScheduledAgentJob>>
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

export function scheduleListSummary(
  job: Awaited<ReturnType<typeof listScheduledAgentJobs>>[number]
) {
  const latestRun = job.latestRun;
  return {
    ...scheduleSummary(job),
    latestRun: latestRun
      ? {
          completedAt: latestRun.completedAt?.toISOString() ?? null,
          id: latestRun.id,
          lastError: latestRun.lastError,
          reportStatus: latestRun.reportStatus,
          scheduledFor: latestRun.scheduledFor.toISOString(),
          sessionId: latestRun.workerSessionId,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          status: latestRun.status,
        }
      : null,
  };
}

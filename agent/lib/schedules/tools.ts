import type { ToolContext } from "eve/tools";
import type { listScheduledAgentJobs } from "@/db/services/scheduled-agent-jobs";
import { scopeFromPrincipal } from "@/lib/access-scope";

export function scheduleOwner(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") {
    throw new Error("An authenticated user is required to manage schedules.");
  }
  return { auth, scope: scopeFromPrincipal(auth) };
}

export function scheduleSummary(
  job: Awaited<ReturnType<typeof listScheduledAgentJobs>>[number]
) {
  return {
    createdAt: job.createdAt,
    id: job.id,
    lastError: job.lastError,
    lastRunAt: job.lastRunAt,
    nextRunAt: job.nextRunAt,
    prompt: job.prompt,
    status: job.status,
    timing: job.timing,
  };
}

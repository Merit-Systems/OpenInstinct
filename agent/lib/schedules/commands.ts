import type { output } from "zod";
import {
  completeScheduledAgentRun,
  createScheduledAgentJob,
  releaseScheduledAgentRun,
  releaseScheduledReport,
  updateScheduledAgentJob,
  waitForScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";
import {
  backfillScheduledWakeups,
  observeScheduledRun,
  scheduledJobWakeups,
  scheduledRunWakeups,
} from "@db/services/scheduled-agent-wakeups";
import { scheduleSummary } from "./tools";
import type {
  scheduledResponseSchema,
  ScheduledCommand,
} from "@shared/schedules/wakeups";

export async function applyScheduledCommand(command: ScheduledCommand) {
  if (command.kind === "backfill")
    return backfillScheduledWakeups(command.cursor);
  if (command.kind === "observe")
    return { wakeups: await observeScheduledRun(command.runId), result: {} };
  const now = new Date(command.at);
  if (command.kind === "create" || command.kind === "update") {
    const job =
      command.kind === "create"
        ? await createScheduledAgentJob(
            command.scope,
            { ...command.conversation, ...command.input },
            now
          )
        : await updateScheduledAgentJob(
            command.scope,
            command.conversation,
            command.id,
            command.patch,
            now,
            { id: command.mutationId, revision: command.expectedRevision }
          );
    return {
      wakeups: job ? await scheduledJobWakeups(job.id) : [],
      result: job
        ? { job: scheduleSummary(job) }
        : { status: "stale" as const },
    };
  }
  let result: output<typeof scheduledResponseSchema>["result"] = {};
  switch (command.kind) {
    case "input": {
      const run = await waitForScheduledAgentRunInput(
        command.runId,
        command.leaseToken,
        command.requests,
        now
      );
      result = { reportStatus: run?.reportStatus };
      break;
    }
    case "complete": {
      const completed = await completeScheduledAgentRun(
        command.runId,
        command.leaseToken,
        command.turnId,
        command.outcome,
        now
      );
      result = {
        status: completed?.status ?? "stale",
        reportStatus:
          completed?.status === "completed"
            ? completed.run.reportStatus
            : undefined,
      };
      break;
    }
    case "release": {
      const nextStatus = await releaseScheduledAgentRun(
        command.runId,
        command.leaseToken,
        command.message,
        now
      );
      result = { nextStatus };
      break;
    }
    case "release-report":
      await releaseScheduledReport(
        command.runId,
        command.leaseToken,
        command.message,
        now
      );
      break;
  }
  return { wakeups: await scheduledRunWakeups(command.runId), result };
}

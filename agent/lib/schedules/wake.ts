import type { RouteHandlerArgs, defineChannel } from "eve/channels";
import type { ScheduleToFn } from "eve/schedules";
import { dispatchScheduledReport } from "@agent/lib/schedules/report";
import { postScheduledReport } from "@agent/lib/schedules/request";
import {
  claimReadyScheduledAgentRuns,
  type listRecoverableScheduledReports,
  materializeDueScheduledAgentRuns,
  releaseScheduledAgentRun,
  setScheduledRunSession,
} from "@db/services/scheduled-agent-jobs";
import {
  scheduledJobWakeups,
  observeScheduledRun,
  scheduledRunWakeups,
} from "@db/services/scheduled-agent-wakeups";
import type { ScheduledWakeup } from "@shared/schedules/wakeups";

const workerStartupLimitMs = 5 * 60_000;

export async function dispatchScheduledWakeup(
  delivery: Pick<RouteHandlerArgs, "to" | "attachSession">,
  wakeup: ScheduledWakeup,
  workerChannel: ReturnType<typeof defineChannel>
) {
  const now = new Date();
  if (new Date(wakeup.at) > now) return { wakeups: [wakeup], result: {} };
  if (wakeup.kind === "legacy-run")
    return {
      wakeups: await observeScheduledRun(wakeup.runId, wakeup.deadline),
      result: {},
    };
  if (wakeup.kind === "job") {
    await materializeDueScheduledAgentRuns({
      limit: 1,
      now,
      job: {
        id: wakeup.jobId,
        revision: wakeup.revision,
        at: new Date(wakeup.at),
      },
    });
    return {
      wakeups: await scheduledJobWakeups(wakeup.jobId),
      result: {},
    };
  }
  if (wakeup.kind === "run") {
    const claims = await claimReadyScheduledAgentRuns({
      limit: 1,
      now,
      leaseForMs: workerStartupLimitMs,
      wakeup,
    });
    await Promise.all(
      claims.map((claim) =>
        executeScheduledRun(delivery.to, claim, workerChannel)
      )
    );
  } else {
    await dispatchScheduledReport(delivery, wakeup.runId, wakeup.sequence);
  }
  return { wakeups: await scheduledRunWakeups(wakeup.runId), result: {} };
}

async function executeScheduledRun(
  to: ScheduleToFn,
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number],
  workerChannel: ReturnType<typeof defineChannel>
) {
  const leaseToken = claim.run.leaseToken;
  if (!leaseToken) throw new Error("A scheduled run claim requires a lease.");
  console.info("[scheduled-run] dispatching worker", {
    attempt: claim.run.attempts,
    jobId: claim.job.id,
    runId: claim.run.id,
    scheduledFor: claim.run.scheduledFor.toISOString(),
  });
  try {
    const session = await to(workerChannel, {
      restart: claim.run.attempts > 1 || claim.run.workerSessionId !== null,
      runId: claim.run.id,
    }).send(scheduledRunPrompt(claim), {
      auth: scheduledWorkerAuth(claim),
    });
    const persisted = await setScheduledRunSession(
      claim.run.id,
      leaseToken,
      session.id
    );
    if (!persisted) {
      throw new Error("The scheduled run lease expired during dispatch.");
    }
    console.info("[scheduled-run] worker session accepted", {
      jobId: claim.job.id,
      runId: claim.run.id,
      sessionId: session.id,
    });
  } catch (error) {
    console.warn("[scheduled-run] worker dispatch failed", {
      cause: error,
      jobId: claim.job.id,
      runId: claim.run.id,
    });
    const status = await releaseScheduledAgentRun(
      claim.run.id,
      leaseToken,
      error instanceof Error ? error.message : String(error)
    );
    if (status === "dead_letter") {
      await dispatchRecoverableReport(to, {
        conversationChannel: claim.job.conversationChannel,
        runId: claim.run.id,
      });
    }
  }
}

function dispatchRecoverableReport(
  to: ScheduleToFn,
  report: Awaited<ReturnType<typeof listRecoverableScheduledReports>>[number]
) {
  return report.conversationChannel === "linq"
    ? dispatchScheduledReport({ to }, report.runId)
    : postScheduledReport(report.runId);
}

function scheduledRunPrompt(
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  return [
    "Complete this user-owned scheduled task in an isolated background session.",
    `Scheduled for: ${claim.run.scheduledFor.toISOString()}`,
    `Task: ${claim.job.prompt}`,
  ].join("\n\n");
}

function scheduledWorkerAuth(
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  const leaseToken = claim.run.leaseToken;
  if (!leaseToken) throw new Error("A scheduled run claim requires a lease.");
  return {
    attributes: {
      conversationChannel: claim.job.conversationChannel,
      conversationId: claim.job.conversationId,
      scheduleId: claim.job.id,
      scheduledRunLeaseToken: leaseToken,
      scheduledRunId: claim.run.id,
      workspaceId: claim.job.workspaceId,
    },
    authenticator: "scheduled-worker",
    issuer: "open-instinct",
    principalId: claim.job.createdByUserId,
    principalType: "user" as const,
  };
}

import { defineSchedule, type ScheduleToFn } from "eve/schedules";
import { postScheduledReport } from "@/agent/lib/schedules/request";
import {
  claimReadyScheduledAgentRuns,
  listRecoverableScheduledReports,
  materializeDueScheduledAgentRuns,
  releaseScheduledAgentRun,
  setScheduledRunSession,
} from "@/db/services/scheduled-agent-jobs";
import scheduledRun from "../channels/scheduled-run";

const workerRuntimeLimitMs = 6 * 60 * 60_000;

export default defineSchedule({
  cron: "* * * * *",
  run({ to, waitUntil }) {
    waitUntil(dispatchDueWork(to));
  },
});

async function dispatchDueWork(to: ScheduleToFn) {
  const now = new Date();
  await materializeDueScheduledAgentRuns({ limit: 25, now });
  const [runs, reportRunIds] = await Promise.all([
    claimReadyScheduledAgentRuns({
      leaseForMs: workerRuntimeLimitMs,
      limit: 25,
      now,
    }),
    listRecoverableScheduledReports(now, 25),
  ]);
  await Promise.all([
    ...runs.map((claim) => executeScheduledRun(to, claim)),
    ...reportRunIds.map((runId) => postScheduledReport(runId)),
  ]);
}

async function executeScheduledRun(
  to: ScheduleToFn,
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  const leaseToken = claim.run.leaseToken;
  if (!leaseToken) throw new Error("A scheduled run claim requires a lease.");
  try {
    const session = await to(scheduledRun, {
      restart: claim.run.workerSessionId !== null,
      runId: claim.run.id,
    }).send(scheduledRunPrompt(claim), {
      auth: {
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
        principalType: "user",
      },
    });
    await setScheduledRunSession(claim.run.id, leaseToken, session.id);
  } catch (error) {
    await releaseScheduledAgentRun(
      claim.run.id,
      leaseToken,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function scheduledRunPrompt(
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  return [
    "Complete this user-owned scheduled task in an isolated background session.",
    `Scheduled for: ${claim.run.scheduledFor.toISOString()}`,
    `Task: ${claim.job.prompt}`,
    "Return exactly one structured final outcome.",
  ].join("\n\n");
}

import { defineSchedule, type ScheduleToFn } from "eve/schedules";
import { postScheduledReport } from "@/agent/lib/schedules/request";
import {
  claimReadyScheduledAgentRuns,
  listRecoverableScheduledReports,
  materializeDueScheduledAgentRuns,
  releaseScheduledAgentRun,
} from "@/db/services/scheduled-agent-jobs";
import { applicationOrigin } from "@/lib/application-origin";

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
    const response = await fetch(
      new URL("/internal/scheduled-run/start", applicationOrigin()),
      {
        body: JSON.stringify({
          leaseToken,
          restart: claim.run.workerSessionId !== null,
          runId: claim.run.id,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error(
        `Scheduled run dispatch failed (${String(response.status)}).`
      );
    }
  } catch (error) {
    await releaseScheduledAgentRun(
      claim.run.id,
      leaseToken,
      error instanceof Error ? error.message : String(error)
    );
  }
}

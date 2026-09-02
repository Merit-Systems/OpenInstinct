import { defineSchedule } from "eve/schedules";
import {
  postScheduledReport,
  postScheduledRunRoute,
} from "@/agent/lib/schedules/request";
import {
  claimReadyScheduledAgentRuns,
  listRecoverableScheduledReports,
  materializeDueScheduledAgentRuns,
  releaseScheduledAgentRun,
} from "@/db/services/scheduled-agent-jobs";

const workerRuntimeLimitMs = 6 * 60 * 60_000;

export default defineSchedule({
  cron: "* * * * *",
  run({ waitUntil }) {
    waitUntil(dispatchDueWork());
  },
});

async function dispatchDueWork() {
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
    ...runs.map((claim) => executeScheduledRun(claim)),
    ...reportRunIds.map((runId) => postScheduledReport(runId)),
  ]);
}

async function executeScheduledRun(
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  const leaseToken = claim.run.leaseToken;
  if (!leaseToken) throw new Error("A scheduled run claim requires a lease.");
  try {
    const response = await postScheduledRunRoute(
      "/internal/scheduled-run/start",
      {
        leaseToken,
        restart: claim.run.workerSessionId !== null,
        runId: claim.run.id,
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

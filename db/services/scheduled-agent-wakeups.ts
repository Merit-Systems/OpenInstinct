import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, scheduledAgentJobs, scheduledAgentRuns } from "@db";
import type { ScheduledWakeup } from "@shared/schedules/wakeups";

function jobWakeup(
  job: typeof scheduledAgentJobs.$inferSelect
): ScheduledWakeup[] {
  return job.status === "active" && job.nextRunAt
    ? [
        {
          kind: "job",
          jobId: job.id,
          revision: job.revision,
          at: job.nextRunAt.toISOString(),
        },
      ]
    : [];
}

function runWakeups(
  run: typeof scheduledAgentRuns.$inferSelect
): ScheduledWakeup[] {
  const wakeups: ScheduledWakeup[] = [];
  if (
    run.status === "queued" ||
    (run.status === "running" && !run.workerSessionId && run.leaseExpiresAt)
  ) {
    const at =
      run.status === "queued"
        ? (run.retryAt ?? run.createdAt)
        : run.leaseExpiresAt;
    if (at)
      wakeups.push({
        kind: "run",
        runId: run.id,
        attempts: run.attempts,
        leaseToken: run.leaseToken,
        at: at.toISOString(),
      });
  }
  if (["completed", "dead_letter", "waiting_for_input"].includes(run.status)) {
    const at =
      run.reportStatus === "pending"
        ? (run.reportRetryAt ?? run.updatedAt)
        : run.reportStatus === "queued"
          ? run.reportLeaseExpiresAt
          : null;
    if (at)
      wakeups.push({
        kind: "report",
        runId: run.id,
        sequence: run.reportSequence,
        leaseToken: run.reportLeaseToken,
        at: at.toISOString(),
      });
  }
  return wakeups;
}

export async function scheduledJobWakeups(jobId: string) {
  const job = await db.query.scheduledAgentJobs.findFirst({
    where: eq(scheduledAgentJobs.id, jobId),
  });
  if (!job) return [];
  const runs = await db.query.scheduledAgentRuns.findMany({
    where: and(
      eq(scheduledAgentRuns.jobId, jobId),
      or(
        eq(scheduledAgentRuns.status, "queued"),
        and(
          eq(scheduledAgentRuns.status, "running"),
          isNull(scheduledAgentRuns.workerSessionId)
        ),
        inArray(scheduledAgentRuns.reportStatus, ["pending", "queued"])
      )
    ),
  });
  return [...jobWakeup(job), ...runs.flatMap((run) => runWakeups(run))];
}

export async function scheduledRunWakeups(runId: string) {
  const run = await db.query.scheduledAgentRuns.findFirst({
    where: eq(scheduledAgentRuns.id, runId),
  });
  return run ? runWakeups(run) : [];
}

export async function backfillScheduledWakeups(cursor?: string) {
  const [phase = "job", after] = cursor?.split(":") ?? [];
  const limit = 100;
  if (phase === "job") {
    const jobs = await db.query.scheduledAgentJobs.findMany({
      where: and(
        eq(scheduledAgentJobs.status, "active"),
        after ? gt(scheduledAgentJobs.id, after) : undefined
      ),
      orderBy: asc(scheduledAgentJobs.id),
      limit,
    });
    return {
      wakeups: jobs.flatMap(jobWakeup),
      result: {
        cursor:
          jobs.length === limit ? "job:" + (jobs.at(-1)?.id ?? "") : "run",
      },
    };
  }
  const runs = await db.query.scheduledAgentRuns.findMany({
    where: and(
      after ? gt(scheduledAgentRuns.id, after) : undefined,
      or(
        eq(scheduledAgentRuns.status, "queued"),
        eq(scheduledAgentRuns.status, "running"),
        inArray(scheduledAgentRuns.reportStatus, ["pending", "queued"])
      )
    ),
    orderBy: asc(scheduledAgentRuns.id),
    limit,
  });
  return {
    wakeups: (
      await Promise.all(
        runs.map(async (run) =>
          run.status === "running" && run.workerSessionId
            ? await observeScheduledRun(run.id)
            : runWakeups(run)
        )
      )
    ).flat(),
    result: {
      cursor: runs.length === limit ? "run:" + (runs.at(-1)?.id ?? "") : null,
    },
  };
}

// Only pre-migration sessions have hooks that cannot enqueue durable operations.
// Observe those active sessions during rollout; new sessions report through events.
export async function observeScheduledRun(runId: string, deadline?: string) {
  const run = await db.query.scheduledAgentRuns.findFirst({
    where: eq(scheduledAgentRuns.id, runId),
  });
  if (!run) return [];
  if (run.wakeupManaged) return runWakeups(run);
  const now = new Date();
  const until = deadline
    ? new Date(deadline)
    : new Date(now.getTime() + 6 * 60 * 60_000);
  if (
    run.workerSessionId &&
    (run.status === "running" ||
      (!deadline && run.status === "waiting_for_input")) &&
    now < until
  ) {
    return [
      {
        kind: "legacy-run",
        runId,
        at: new Date(
          Math.floor(now.getTime() / 60_000) * 60_000 + 60_000
        ).toISOString(),
        deadline: until.toISOString(),
      } satisfies ScheduledWakeup,
    ];
  }
  return runWakeups(run);
}

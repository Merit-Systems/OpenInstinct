import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import {
  computeNextRun,
  scheduleTimingSchema,
  type ScheduleTiming,
} from "@/agent/lib/schedules/timing";
import {
  scheduledRunOutcomeSchema,
  type ScheduledRunOutcome,
} from "@/agent/lib/schedules/outcome";
import { db, scheduledAgentJobs, scheduledAgentRuns } from "@/db";

export interface CreateScheduledAgentJob {
  readonly linqThreadId: string;
  readonly missedRunPolicy: "catch_up" | "run_latest";
  readonly prompt: string;
  readonly timing: ScheduleTiming;
}

export interface UpdateScheduledAgentJob {
  readonly prompt?: string;
  readonly status?: "active" | "deleted" | "paused";
  readonly timing?: ScheduleTiming;
}

function parseJob<T extends typeof scheduledAgentJobs.$inferSelect>(job: T) {
  return { ...job, timing: scheduleTimingSchema.parse(job.timing) };
}

function parseRun<T extends typeof scheduledAgentRuns.$inferSelect>(run: T) {
  return {
    ...run,
    outcome: run.outcome ? scheduledRunOutcomeSchema.parse(run.outcome) : null,
  };
}

export async function createScheduledAgentJob(
  scope: AccessScope,
  input: CreateScheduledAgentJob,
  now = new Date()
) {
  const nextRunAt = computeNextRun(input.timing, now);
  if (!nextRunAt) throw new Error("That schedule has no future occurrence.");
  const timestamp = now.toISOString();
  const [job] = await db
    .insert(scheduledAgentJobs)
    .values({
      createdAt: timestamp,
      createdByUserId: scope.userId,
      id: randomUUID(),
      linqThreadId: input.linqThreadId,
      missedRunPolicy: input.missedRunPolicy,
      nextRunAt: nextRunAt.toISOString(),
      prompt: input.prompt,
      status: "active",
      timing: input.timing,
      updatedAt: timestamp,
      workspaceId: scope.workspaceId,
    })
    .returning();
  if (!job) throw new Error("The schedule could not be created.");
  return parseJob(job);
}

export async function listScheduledAgentJobs(scope: AccessScope) {
  const jobs = await db
    .select()
    .from(scheduledAgentJobs)
    .where(
      and(
        eq(scheduledAgentJobs.workspaceId, scope.workspaceId),
        eq(scheduledAgentJobs.createdByUserId, scope.userId),
        sql`${scheduledAgentJobs.status} <> 'deleted'`
      )
    )
    .orderBy(asc(scheduledAgentJobs.nextRunAt));
  return jobs.map(parseJob);
}

export async function updateScheduledAgentJob(
  scope: AccessScope,
  id: string,
  patch: UpdateScheduledAgentJob,
  now = new Date()
) {
  const current = await db.query.scheduledAgentJobs.findFirst({
    where: and(
      eq(scheduledAgentJobs.id, id),
      eq(scheduledAgentJobs.workspaceId, scope.workspaceId),
      eq(scheduledAgentJobs.createdByUserId, scope.userId),
      sql`${scheduledAgentJobs.status} <> 'deleted'`
    ),
  });
  if (!current) return undefined;
  const timing = patch.timing ?? scheduleTimingSchema.parse(current.timing);
  const status = patch.status ?? current.status;
  const shouldRecompute =
    patch.timing !== undefined ||
    (patch.status === "active" && current.status !== "active");
  const nextRunAt =
    status !== "active"
      ? null
      : shouldRecompute
        ? computeNextRun(timing, now)?.toISOString()
        : current.nextRunAt;
  if (status === "active" && !nextRunAt) {
    throw new Error("That schedule has no future occurrence.");
  }
  const [job] = await db
    .update(scheduledAgentJobs)
    .set({
      ...patch,
      nextRunAt,
      revision: sql`${scheduledAgentJobs.revision} + 1`,
      timing,
      updatedAt: now.toISOString(),
    })
    .where(eq(scheduledAgentJobs.id, current.id))
    .returning();
  return job ? parseJob(job) : undefined;
}

export async function materializeDueScheduledAgentRuns(options: {
  readonly limit: number;
  readonly now: Date;
}) {
  return db.transaction(async (transaction) => {
    const due = await transaction
      .select()
      .from(scheduledAgentJobs)
      .where(
        and(
          eq(scheduledAgentJobs.status, "active"),
          lte(scheduledAgentJobs.nextRunAt, options.now.toISOString())
        )
      )
      .orderBy(asc(scheduledAgentJobs.nextRunAt))
      .limit(options.limit)
      .for("update", { skipLocked: true });
    const createdRunIds = await Promise.all(
      due.map(async (job) => {
        if (!job.nextRunAt) return undefined;
        const scheduledFor = job.nextRunAt;
        const timing = scheduleTimingSchema.parse(job.timing);
        const next = computeNextRun(
          timing,
          job.missedRunPolicy === "catch_up"
            ? new Date(scheduledFor)
            : options.now
        );
        const [run] = await transaction
          .insert(scheduledAgentRuns)
          .values({
            createdAt: options.now.toISOString(),
            id: randomUUID(),
            jobId: job.id,
            scheduledFor,
            updatedAt: options.now.toISOString(),
          })
          .onConflictDoNothing({
            target: [scheduledAgentRuns.jobId, scheduledAgentRuns.scheduledFor],
          })
          .returning({ id: scheduledAgentRuns.id });
        await transaction
          .update(scheduledAgentJobs)
          .set({
            lastRunAt: scheduledFor,
            nextRunAt: next?.toISOString() ?? null,
            status: next ? "active" : "completed",
            updatedAt: options.now.toISOString(),
          })
          .where(eq(scheduledAgentJobs.id, job.id));
        return run?.id;
      })
    );
    return createdRunIds.filter((id) => id !== undefined);
  });
}

export async function claimReadyScheduledAgentRuns(options: {
  readonly leaseForMs: number;
  readonly limit: number;
  readonly now: Date;
}) {
  return db.transaction(async (transaction) => {
    const ready = await transaction
      .select({ job: scheduledAgentJobs, run: scheduledAgentRuns })
      .from(scheduledAgentRuns)
      .innerJoin(
        scheduledAgentJobs,
        eq(scheduledAgentRuns.jobId, scheduledAgentJobs.id)
      )
      .where(
        and(
          or(
            eq(scheduledAgentRuns.status, "queued"),
            and(
              eq(scheduledAgentRuns.status, "running"),
              lte(scheduledAgentRuns.leaseExpiresAt, options.now.toISOString())
            )
          ),
          or(
            isNull(scheduledAgentRuns.retryAt),
            lte(scheduledAgentRuns.retryAt, options.now.toISOString())
          )
        )
      )
      .orderBy(asc(scheduledAgentRuns.scheduledFor))
      .limit(options.limit)
      .for("update", { of: scheduledAgentRuns, skipLocked: true });
    if (ready.length === 0) return [];
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      options.now.getTime() + options.leaseForMs
    ).toISOString();
    const ids = ready.map(({ run }) => run.id);
    await transaction
      .update(scheduledAgentRuns)
      .set({
        attempts: sql`${scheduledAgentRuns.attempts} + 1`,
        leaseExpiresAt,
        leaseToken,
        startedAt: options.now.toISOString(),
        status: "running",
        updatedAt: options.now.toISOString(),
      })
      .where(inArray(scheduledAgentRuns.id, ids));
    return ready.map(({ job, run }) => ({
      job: parseJob(job),
      run: parseRun({
        ...run,
        attempts: run.attempts + 1,
        leaseExpiresAt,
        leaseToken,
        startedAt: options.now.toISOString(),
        status: "running",
      }),
    }));
  });
}

export async function setScheduledRunSession(
  runId: string,
  leaseToken: string,
  workerSessionId: string
) {
  await db
    .update(scheduledAgentRuns)
    .set({ workerSessionId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.leaseToken, leaseToken)
      )
    );
}

export async function completeScheduledAgentRun(
  runId: string,
  leaseToken: string,
  outcome: ScheduledRunOutcome,
  completedAt = new Date()
) {
  const [run] = await db
    .update(scheduledAgentRuns)
    .set({
      completedAt: completedAt.toISOString(),
      lastError: null,
      leaseExpiresAt: null,
      leaseToken: null,
      outcome,
      reportStatus:
        outcome.kind === "nothing_to_report" ? "not_needed" : "pending",
      status: "completed",
      updatedAt: completedAt.toISOString(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.leaseToken, leaseToken)
      )
    )
    .returning();
  return run ? parseRun(run) : undefined;
}

export async function releaseScheduledAgentRun(
  runId: string,
  leaseToken: string,
  errorMessage: string,
  now = new Date()
) {
  const run = await db.query.scheduledAgentRuns.findFirst({
    where: and(
      eq(scheduledAgentRuns.id, runId),
      eq(scheduledAgentRuns.leaseToken, leaseToken)
    ),
  });
  if (!run) return;
  const dead = run.attempts >= 3;
  await db
    .update(scheduledAgentRuns)
    .set({
      lastError: errorMessage.slice(0, 2_000),
      leaseExpiresAt: null,
      leaseToken: null,
      retryAt: dead ? null : new Date(now.getTime() + 5 * 60_000).toISOString(),
      status: dead ? "dead_letter" : "queued",
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, run.id),
        eq(scheduledAgentRuns.leaseToken, leaseToken)
      )
    );
}

export async function claimScheduledReport(runId: string, now = new Date()) {
  const leaseToken = randomUUID();
  const [claimed] = await db
    .update(scheduledAgentRuns)
    .set({
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      leaseToken,
      reportStatus: "queued",
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.status, "completed"),
        eq(scheduledAgentRuns.reportStatus, "pending")
      )
    )
    .returning();
  if (!claimed) return undefined;
  const claimedWithJob = await db.query.scheduledAgentRuns.findFirst({
    where: eq(scheduledAgentRuns.id, claimed.id),
    with: { job: true },
  });
  if (!claimedWithJob) return undefined;
  const { job, ...run } = claimedWithJob;
  return { job: parseJob(job), run: parseRun(run) };
}

export async function listRecoverableScheduledReports(
  now = new Date(),
  limit = 25
) {
  return db.transaction(async (transaction) => {
    const runs = await transaction
      .select()
      .from(scheduledAgentRuns)
      .where(
        and(
          eq(scheduledAgentRuns.status, "completed"),
          or(
            eq(scheduledAgentRuns.reportStatus, "pending"),
            and(
              eq(scheduledAgentRuns.reportStatus, "queued"),
              lte(scheduledAgentRuns.leaseExpiresAt, now.toISOString())
            )
          )
        )
      )
      .orderBy(asc(scheduledAgentRuns.updatedAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    const stale = runs.filter((run) => run.reportStatus === "queued");
    if (stale.length > 0) {
      await transaction
        .update(scheduledAgentRuns)
        .set({
          leaseExpiresAt: null,
          leaseToken: null,
          reportStatus: "pending",
          updatedAt: now.toISOString(),
        })
        .where(
          and(
            inArray(
              scheduledAgentRuns.id,
              stale.map((run) => run.id)
            ),
            eq(scheduledAgentRuns.reportStatus, "queued"),
            lte(scheduledAgentRuns.leaseExpiresAt, now.toISOString())
          )
        );
    }
    return runs.map((run) => run.id);
  });
}

export async function releaseScheduledReport(
  runId: string,
  leaseToken: string,
  errorMessage: string
) {
  await db
    .update(scheduledAgentRuns)
    .set({
      lastError: errorMessage.slice(0, 2_000),
      leaseExpiresAt: null,
      leaseToken: null,
      reportStatus: "pending",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.leaseToken, leaseToken)
      )
    );
}

export async function finalizeScheduledReport(
  runId: string,
  leaseToken: string,
  reportStatus: "delivered" | "suppressed"
) {
  await db
    .update(scheduledAgentRuns)
    .set({
      leaseExpiresAt: null,
      leaseToken: null,
      reportStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.leaseToken, leaseToken),
        eq(scheduledAgentRuns.reportStatus, "queued")
      )
    );
}

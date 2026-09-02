import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import {
  computeNextRun,
  computeLatestRun,
  scheduleTimingSchema,
  type ScheduleTiming,
} from "@/agent/lib/schedules/timing";
import {
  scheduledRunOutcomeSchema,
  type ScheduledRunOutcome,
} from "@/agent/lib/schedules/outcome";
import { db, scheduledAgentJobs, scheduledAgentRuns } from "@/db";

export interface CreateScheduledAgentJob {
  readonly conversationChannel: "eve" | "linq";
  readonly conversationId: string;
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
  const [job] = await db
    .insert(scheduledAgentJobs)
    .values({
      createdAt: now,
      createdByUserId: scope.userId,
      conversationChannel: input.conversationChannel,
      conversationId: input.conversationId,
      missedRunPolicy: input.missedRunPolicy,
      nextRunAt,
      prompt: input.prompt,
      status: "active",
      timing: input.timing,
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .returning();
  if (!job) throw new Error("The schedule could not be created.");
  return parseJob(job);
}

export async function listScheduledAgentJobs(
  scope: AccessScope,
  conversation: Pick<
    CreateScheduledAgentJob,
    "conversationChannel" | "conversationId"
  >
) {
  const jobs = await db.query.scheduledAgentJobs.findMany({
    orderBy: asc(scheduledAgentJobs.nextRunAt),
    where: and(
      eq(scheduledAgentJobs.workspaceId, scope.workspaceId),
      eq(scheduledAgentJobs.createdByUserId, scope.userId),
      eq(
        scheduledAgentJobs.conversationChannel,
        conversation.conversationChannel
      ),
      eq(scheduledAgentJobs.conversationId, conversation.conversationId),
      sql`${scheduledAgentJobs.status} <> 'deleted'`
    ),
    with: {
      runs: {
        limit: 1,
        orderBy: desc(scheduledAgentRuns.scheduledFor),
      },
    },
  });
  return jobs.map(({ runs, ...job }) =>
    parseJob({ ...job, lastError: runs[0]?.lastError ?? job.lastError })
  );
}

export async function updateScheduledAgentJob(
  scope: AccessScope,
  conversation: Pick<
    CreateScheduledAgentJob,
    "conversationChannel" | "conversationId"
  >,
  id: string,
  patch: UpdateScheduledAgentJob,
  now = new Date()
) {
  const current = await db.query.scheduledAgentJobs.findFirst({
    where: and(
      eq(scheduledAgentJobs.id, id),
      eq(scheduledAgentJobs.workspaceId, scope.workspaceId),
      eq(scheduledAgentJobs.createdByUserId, scope.userId),
      eq(
        scheduledAgentJobs.conversationChannel,
        conversation.conversationChannel
      ),
      eq(scheduledAgentJobs.conversationId, conversation.conversationId),
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
        ? computeNextRun(timing, now)
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
      updatedAt: now,
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
          lte(scheduledAgentJobs.nextRunAt, options.now)
        )
      )
      .orderBy(asc(scheduledAgentJobs.nextRunAt))
      .limit(options.limit)
      .for("update", { skipLocked: true });
    const createdRunIds = await Promise.all(
      due.map(async (job) => {
        if (!job.nextRunAt) return undefined;
        const timing = scheduleTimingSchema.parse(job.timing);
        const scheduledFor =
          job.missedRunPolicy === "catch_up"
            ? job.nextRunAt
            : (computeLatestRun(timing, options.now) ?? job.nextRunAt);
        const next = computeNextRun(timing, scheduledFor);
        const [run] = await transaction
          .insert(scheduledAgentRuns)
          .values({
            createdAt: options.now,
            jobId: job.id,
            scheduledFor,
            updatedAt: options.now,
          })
          .onConflictDoNothing({
            target: [scheduledAgentRuns.jobId, scheduledAgentRuns.scheduledFor],
          })
          .returning({ id: scheduledAgentRuns.id });
        await transaction
          .update(scheduledAgentJobs)
          .set({
            lastRunAt: scheduledFor,
            nextRunAt: next,
            status: next ? "active" : "completed",
            updatedAt: options.now,
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
              lte(scheduledAgentRuns.leaseExpiresAt, options.now)
            )
          ),
          or(
            isNull(scheduledAgentRuns.retryAt),
            lte(scheduledAgentRuns.retryAt, options.now)
          )
        )
      )
      .orderBy(asc(scheduledAgentRuns.scheduledFor))
      .limit(options.limit)
      .for("update", { of: scheduledAgentRuns, skipLocked: true });
    if (ready.length === 0) return [];
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(options.now.getTime() + options.leaseForMs);
    const ids = ready.map(({ run }) => run.id);
    await transaction
      .update(scheduledAgentRuns)
      .set({
        attempts: sql`${scheduledAgentRuns.attempts} + 1`,
        leaseExpiresAt,
        leaseToken,
        startedAt: options.now,
        status: "running",
        updatedAt: options.now,
      })
      .where(inArray(scheduledAgentRuns.id, ids));
    return ready.map(({ job, run }) => ({
      job: parseJob(job),
      run: parseRun({
        ...run,
        attempts: run.attempts + 1,
        leaseExpiresAt,
        leaseToken,
        startedAt: options.now,
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
    .set({ workerSessionId, updatedAt: new Date() })
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
      completedAt,
      lastError: null,
      leaseExpiresAt: null,
      leaseToken: null,
      outcome,
      reportSequence:
        outcome.kind === "nothing_to_report"
          ? scheduledAgentRuns.reportSequence
          : sql`${scheduledAgentRuns.reportSequence} + 1`,
      reportStatus:
        outcome.kind === "nothing_to_report" ? "not_needed" : "pending",
      status: "completed",
      updatedAt: completedAt,
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
      retryAt: dead ? null : new Date(now.getTime() + 5 * 60_000),
      status: dead ? "dead_letter" : "queued",
      updatedAt: now,
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
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      leaseToken,
      reportStatus: "queued",
      updatedAt: now,
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
              lte(scheduledAgentRuns.leaseExpiresAt, now)
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
          updatedAt: now,
        })
        .where(
          and(
            inArray(
              scheduledAgentRuns.id,
              stale.map((run) => run.id)
            ),
            eq(scheduledAgentRuns.reportStatus, "queued"),
            lte(scheduledAgentRuns.leaseExpiresAt, now)
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
      updatedAt: new Date(),
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
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, runId),
        eq(scheduledAgentRuns.leaseToken, leaseToken),
        eq(scheduledAgentRuns.reportStatus, "queued")
      )
    );
}

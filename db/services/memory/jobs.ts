/* oxlint-disable eslint/no-await-in-loop -- Transaction mutations and validations must follow their dependent writes. */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  db,
  memoryArtifacts,
  memoryGenerations,
  memoryJobs,
  memoryLinks,
  memoryRecords,
  memoryRevisions,
  memorySources,
  workspaceMemberships,
} from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  memoryProposalSchema,
  type MemoryProposal,
} from "@shared/memory/schema";
import { lockMemoryState, type MemoryTransaction } from "./scope";
import { enqueueMemoryJob } from "./sources";
import { writeMemoryRecord } from "./records";
import { publishMemoryGeneration } from "./generations";

export async function listReadyMemoryJobs(
  limit = 25,
  workspaceIds?: readonly string[]
) {
  if (workspaceIds?.length === 0) return [];
  const now = new Date();
  const rows = await db
    .select({ job: memoryJobs })
    .from(memoryJobs)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, memoryJobs.workspaceId),
        eq(workspaceMemberships.userId, memoryJobs.requestedByUserId)
      )
    )
    .where(
      and(
        workspaceIds
          ? inArray(memoryJobs.workspaceId, [...workspaceIds])
          : undefined,
        or(
          and(
            eq(memoryJobs.status, "pending"),
            lte(memoryJobs.availableAt, now)
          ),
          and(
            eq(memoryJobs.status, "running"),
            lte(memoryJobs.leaseExpiresAt, now)
          )
        )
      )
    )
    .orderBy(asc(memoryJobs.availableAt), asc(memoryJobs.createdAt))
    .limit(z.number().int().min(1).max(100).parse(limit));
  return rows.map(({ job }) => ({
    id: job.id,
    scopeKey: job.scopeKey,
    scope: { workspaceId: job.workspaceId, userId: job.requestedByUserId },
  }));
}

export async function claimMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  input: { now?: Date; leaseMs?: number } = {}
) {
  const now = input.now ?? new Date();
  const leaseMs = z
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .parse(input.leaseMs ?? 120_000);
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const [job] = await transaction
      .select()
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, jobId)
        )
      )
      .limit(1);
    if (
      !job ||
      job.requestedByUserId !== scope.userId ||
      !["pending", "running"].includes(job.status) ||
      job.availableAt > now ||
      (job.leaseExpiresAt && job.leaseExpiresAt > now)
    )
      return null;
    const [running] = await transaction
      .select({ id: memoryJobs.id })
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.status, "running"),
          gt(memoryJobs.leaseExpiresAt, now)
        )
      )
      .limit(1);
    if (running) return null;
    if (job.epoch !== state.deletionEpoch || job.attempts >= 5) {
      await transaction
        .update(memoryJobs)
        .set({
          status: job.attempts >= 5 ? "dead_letter" : "cancelled",
          checkpoint: null,
          sourceVersions: [],
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(eq(memoryJobs.id, job.id));
      if (job.attempts >= 5 && job.epoch === state.deletionEpoch)
        await failMemoryJobSources(transaction, scope, scopeKey, job);
      return null;
    }
    let sources = await transaction
      .select()
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.status, "pending"),
          isNotNull(memorySources.text),
          job.checkpoint
            ? inArray(
                memorySources.id,
                job.sourceVersions.map((source) => source.id)
              )
            : undefined
        )
      )
      .orderBy(asc(memorySources.createdAt), asc(memorySources.id))
      .limit(1);
    const exportRecords = await findUnpublishedMemoryRecords(
      transaction,
      scope,
      scopeKey
    );
    if (exportRecords.length && !job.checkpoint) sources = [];
    if (!sources.length && !exportRecords.length) {
      await transaction
        .update(memoryJobs)
        .set({ status: "completed", checkpoint: null })
        .where(eq(memoryJobs.id, job.id));
      return null;
    }
    const [claimed] = await transaction
      .update(memoryJobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        sourceVersions: sources.map(({ id, version }) => ({ id, version })),
      })
      .where(eq(memoryJobs.id, job.id))
      .returning();
    if (!claimed?.leaseToken)
      throw new Error("The memory job could not be claimed.");
    return {
      ...claimed,
      leaseToken: claimed.leaseToken,
      sources,
      exportRecords,
    };
  });
}

async function readMemoryJobLease(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  expectedEpoch?: number
) {
  const state = await lockMemoryState(transaction, scope, scopeKey);
  const [job] = await transaction
    .select()
    .from(memoryJobs)
    .where(
      and(
        eq(memoryJobs.workspaceId, scope.workspaceId),
        eq(memoryJobs.scopeKey, scopeKey),
        eq(memoryJobs.id, jobId),
        eq(memoryJobs.requestedByUserId, scope.userId),
        eq(memoryJobs.status, "running"),
        eq(memoryJobs.leaseToken, leaseToken),
        gt(memoryJobs.leaseExpiresAt, new Date())
      )
    )
    .limit(1);
  if (
    !job ||
    job.epoch !== state.deletionEpoch ||
    (expectedEpoch !== undefined && job.epoch !== expectedEpoch)
  )
    throw new Error(
      "The memory maintenance lease or deletion epoch is no longer valid."
    );
  return job;
}

export async function requireMemoryJobLease(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  expectedEpoch?: number
) {
  const job = await readMemoryJobLease(
    transaction,
    scope,
    scopeKey,
    jobId,
    leaseToken,
    expectedEpoch
  );
  for (const reference of job.sourceVersions) {
    const [source] = await transaction
      .select()
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, reference.id),
          eq(memorySources.version, reference.version),
          eq(memorySources.status, "pending"),
          isNotNull(memorySources.text)
        )
      )
      .limit(1);
    if (!source) throw new Error("A memory source changed during maintenance.");
  }
  return job;
}

export async function checkpointMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  proposal: MemoryProposal
) {
  const parsed = memoryProposalSchema.parse(proposal);
  return db.transaction(async (transaction) => {
    await requireMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      jobId,
      leaseToken
    );
    await transaction
      .update(memoryJobs)
      .set({ checkpoint: parsed })
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, jobId)
        )
      );
  });
}

export async function publishMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  input: MemoryProposal & {
    jobId: string;
    leaseToken: string;
    expectedEpoch: number;
    expectedGeneration?: number;
    artifacts?: readonly {
      pathname: string;
      sha256: string;
      recordId: string;
      revision: number;
    }[];
  }
) {
  const proposal = memoryProposalSchema.parse({
    records: input.records,
    links: input.links,
  });
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const [completed] = await transaction
      .select()
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, input.jobId),
          eq(memoryJobs.requestedByUserId, scope.userId),
          eq(memoryJobs.leaseToken, input.leaseToken),
          eq(memoryJobs.status, "completed")
        )
      )
      .limit(1);
    if (
      completed &&
      completed.epoch === state.deletionEpoch &&
      completed.epoch === input.expectedEpoch &&
      completed.publishedGeneration !== null
    ) {
      if (!isDeepStrictEqual(completed.checkpoint, proposal))
        throw new Error(
          "A memory job cannot be replayed with different content."
        );
      const [generation] = await transaction
        .select()
        .from(memoryGenerations)
        .where(
          and(
            eq(memoryGenerations.workspaceId, scope.workspaceId),
            eq(memoryGenerations.scopeKey, scopeKey),
            eq(memoryGenerations.generation, completed.publishedGeneration)
          )
        )
        .limit(1);
      if (generation) return generation;
    }
    if (
      input.expectedGeneration !== undefined &&
      input.expectedGeneration !== state.generation
    )
      throw new Error(
        "Memory changed while preparing linked snapshots. Retry maintenance."
      );
    const job = await requireMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      input.jobId,
      input.leaseToken,
      input.expectedEpoch
    );
    for (const record of proposal.records)
      await writeMemoryRecord(
        transaction,
        scope,
        scopeKey,
        record,
        `job:${job.id}:${record.id}`,
        false,
        job.sourceVersions
      );
    for (const link of proposal.links) {
      if (link.relation !== "co-mentioned")
        throw new Error(
          "Only evidence-backed co-mentioned links are supported."
        );
      const endpoints = await transaction
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.workspaceId, scope.workspaceId),
            eq(memoryRecords.scopeKey, scopeKey),
            inArray(memoryRecords.id, [...new Set([link.fromId, link.toId])]),
            isNotNull(memoryRecords.content)
          )
        );
      if (link.fromId === link.toId || endpoints.length !== 2)
        throw new Error(
          "A memory link must join two current records in this scope."
        );
      const commonSource = endpoints[0]?.content?.evidence.some((source) =>
        endpoints[1]?.content?.evidence.some(
          (other) => source.sourceId === other.sourceId
        )
      );
      if (!commonSource)
        throw new Error("A memory link requires shared supporting evidence.");
      const insertedLinks = await transaction
        .insert(memoryLinks)
        .values({ workspaceId: scope.workspaceId, scopeKey, ...link })
        .onConflictDoNothing()
        .returning();
      if (insertedLinks.length)
        await transaction
          .update(memoryArtifacts)
          .set({ status: "purge" })
          .where(
            and(
              eq(memoryArtifacts.workspaceId, scope.workspaceId),
              eq(memoryArtifacts.scopeKey, scopeKey),
              inArray(memoryArtifacts.recordId, [link.fromId, link.toId]),
              eq(memoryArtifacts.status, "published")
            )
          );
    }
    for (const artifact of input.artifacts ?? []) {
      const [reserved] = await transaction
        .select()
        .from(memoryArtifacts)
        .where(
          and(
            eq(memoryArtifacts.workspaceId, scope.workspaceId),
            eq(memoryArtifacts.scopeKey, scopeKey),
            eq(memoryArtifacts.pathname, artifact.pathname),
            eq(memoryArtifacts.jobId, job.id),
            eq(memoryArtifacts.sha256, artifact.sha256),
            eq(memoryArtifacts.status, "staged")
          )
        )
        .limit(1);
      if (
        !reserved ||
        reserved.recordId !== artifact.recordId ||
        reserved.revision !== artifact.revision
      )
        throw new Error("The memory artifact was not reserved by this job.");
      const [record] = await transaction
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.workspaceId, scope.workspaceId),
            eq(memoryRecords.scopeKey, scopeKey),
            eq(memoryRecords.id, artifact.recordId),
            eq(memoryRecords.revision, artifact.revision),
            isNotNull(memoryRecords.content)
          )
        )
        .limit(1);
      if (!record)
        throw new Error(
          "The artifact revision does not match the published record."
        );
    }
    const generation = await publishMemoryGeneration(
      transaction,
      scope,
      scopeKey
    );
    await transaction
      .update(memoryArtifacts)
      .set({ status: "published" })
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey),
          eq(memoryArtifacts.jobId, job.id),
          inArray(
            memoryArtifacts.pathname,
            (input.artifacts ?? []).map((artifact) => artifact.pathname)
          )
        )
      );
    const consumed = and(
      eq(memorySources.workspaceId, scope.workspaceId),
      eq(memorySources.scopeKey, scopeKey),
      inArray(
        memorySources.id,
        job.sourceVersions.map((source) => source.id)
      )
    );
    const supported = sql`EXISTS (SELECT 1 FROM ${memoryRecords}, jsonb_array_elements(${memoryRecords.content}->'evidence') AS span WHERE ${memoryRecords.workspaceId} = ${memorySources.workspaceId} AND ${memoryRecords.scopeKey} = ${memorySources.scopeKey} AND span->>'sourceId' = ${memorySources.id}) OR EXISTS (SELECT 1 FROM ${memoryRevisions}, jsonb_array_elements(${memoryRevisions.content}->'evidence') AS span WHERE ${memoryRevisions.workspaceId} = ${memorySources.workspaceId} AND ${memoryRevisions.scopeKey} = ${memorySources.scopeKey} AND span->>'sourceId' = ${memorySources.id})`;
    await transaction
      .update(memorySources)
      .set({ status: "processed" })
      .where(and(consumed, supported));
    await transaction
      .update(memorySources)
      .set({
        status: "excluded",
        text: null,
        reference: null,
        sessionId: null,
        turnId: null,
      })
      .where(and(consumed, eq(memorySources.status, "pending")));
    await transaction
      .update(memoryJobs)
      .set({
        status: "completed",
        publishedGeneration: generation.generation,
        checkpoint: proposal,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, job.id)
        )
      );
    const [pending] = await transaction
      .select({ id: memorySources.id })
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.status, "pending"),
          isNotNull(memorySources.text)
        )
      )
      .limit(1);
    if (
      pending ||
      (await findUnpublishedMemoryRecords(transaction, scope, scopeKey)).length
    )
      await enqueueMemoryJob(transaction, scope, scopeKey, input.expectedEpoch);
    return generation;
  });
}

async function findUnpublishedMemoryRecords(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string
) {
  const rows = await transaction
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.workspaceId, scope.workspaceId),
        eq(memoryRecords.scopeKey, scopeKey),
        isNotNull(memoryRecords.content),
        sql`NOT EXISTS (SELECT 1 FROM ${memoryArtifacts} WHERE ${memoryArtifacts.workspaceId} = ${memoryRecords.workspaceId} AND ${memoryArtifacts.scopeKey} = ${memoryRecords.scopeKey} AND ${memoryArtifacts.recordId} = ${memoryRecords.id} AND ${memoryArtifacts.revision} = ${memoryRecords.revision} AND ${memoryArtifacts.status} = 'published')`
      )
    )
    .orderBy(asc(memoryRecords.updatedAt), asc(memoryRecords.id))
    .limit(10);
  return rows.flatMap((row) =>
    row.content
      ? [{ id: row.id, revision: row.revision, content: row.content }]
      : []
  );
}

export async function rejectMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string
) {
  await db.transaction(async (transaction) => {
    const job = await readMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      jobId,
      leaseToken
    );
    if (job.checkpoint)
      throw new Error(
        "A checkpointed memory job does not need a model budget."
      );
    await transaction
      .update(memoryJobs)
      .set({
        status: "dead_letter",
        checkpoint: null,
        sourceVersions: [],
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(eq(memoryJobs.id, job.id));
    await failMemoryJobSources(transaction, scope, scopeKey, job);
  });
}

export async function deferMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  availableAt: Date
) {
  await db.transaction(async (transaction) => {
    const job = await readMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      jobId,
      leaseToken
    );
    if (job.checkpoint)
      throw new Error(
        "A checkpointed memory job does not need a model budget."
      );
    await transaction
      .update(memoryJobs)
      .set({
        status: "pending",
        attempts: Math.max(0, job.attempts - 1),
        availableAt,
        leaseToken: null,
        leaseExpiresAt: null,
        sourceVersions: [],
      })
      .where(eq(memoryJobs.id, jobId));
  });
}

export async function releaseMemoryJob(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  options: { discardCheckpoint?: boolean } = {}
) {
  return db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, scopeKey);
    const [job] = await transaction
      .select()
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, jobId),
          eq(memoryJobs.leaseToken, leaseToken),
          eq(memoryJobs.status, "running")
        )
      )
      .limit(1);
    if (!job) return;
    await transaction
      .update(memoryJobs)
      .set({
        checkpoint:
          job.attempts >= 5 || options.discardCheckpoint
            ? null
            : job.checkpoint,
        sourceVersions: options.discardCheckpoint ? [] : job.sourceVersions,
        status: job.attempts >= 5 ? "dead_letter" : "pending",
        availableAt: new Date(
          Date.now() + Math.min(300_000, 1_000 * 2 ** job.attempts)
        ),
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey),
          eq(memoryJobs.id, job.id)
        )
      );
    if (job.attempts >= 5)
      await failMemoryJobSources(transaction, scope, scopeKey, job);
    await transaction
      .update(memoryArtifacts)
      .set({ status: "purge" })
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey),
          eq(memoryArtifacts.jobId, job.id),
          eq(memoryArtifacts.status, "staged")
        )
      );
  });
}

async function failMemoryJobSources(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  job: typeof memoryJobs.$inferSelect
) {
  for (const source of job.sourceVersions)
    await transaction
      .update(memorySources)
      .set({
        status: "failed",
        text: null,
        reference: null,
        sessionId: null,
        turnId: null,
      })
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          eq(memorySources.id, source.id),
          eq(memorySources.version, source.version),
          eq(memorySources.status, "pending"),
          sql`NOT EXISTS (SELECT 1 FROM ${memoryRecords}, jsonb_array_elements(${memoryRecords.content}->'evidence') AS span WHERE ${memoryRecords.workspaceId} = ${memorySources.workspaceId} AND ${memoryRecords.scopeKey} = ${memorySources.scopeKey} AND span->>'sourceId' = ${memorySources.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${memoryRevisions}, jsonb_array_elements(${memoryRevisions.content}->'evidence') AS span WHERE ${memoryRevisions.workspaceId} = ${memorySources.workspaceId} AND ${memoryRevisions.scopeKey} = ${memorySources.scopeKey} AND span->>'sourceId' = ${memorySources.id})`
        )
      );
  const [pending] = await transaction
    .select({ id: memorySources.id })
    .from(memorySources)
    .where(
      and(
        eq(memorySources.workspaceId, scope.workspaceId),
        eq(memorySources.scopeKey, scopeKey),
        eq(memorySources.status, "pending"),
        isNotNull(memorySources.text)
      )
    )
    .limit(1);
  if (pending) await enqueueMemoryJob(transaction, scope, scopeKey, job.epoch);
}

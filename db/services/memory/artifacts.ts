/* oxlint-disable eslint/no-await-in-loop -- Transaction mutations and validations must follow their dependent writes. */
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, memoryArtifacts, memoryJobs, workspaceMemberships } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { requireMemoryJobLease } from "./jobs";

const artifactSchema = z.strictObject({
  pathname: z.string().min(1).max(1_024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  recordId: z.string().min(1).max(200),
  revision: z.number().int().positive(),
});

export async function registerMemoryJobArtifacts(
  scope: AccessScope,
  scopeKey: string,
  jobId: string,
  leaseToken: string,
  inputs: readonly z.input<typeof artifactSchema>[]
) {
  const artifacts = z.array(artifactSchema).max(40).parse(inputs);
  return db.transaction(async (transaction) => {
    await requireMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      jobId,
      leaseToken
    );
    for (const artifact of artifacts) {
      if (
        !artifact.pathname.startsWith("memory/") ||
        !artifact.pathname.split("/").includes(jobId) ||
        !artifact.pathname.split("/").includes(leaseToken) ||
        artifact.pathname.includes("..")
      )
        throw new Error(
          "Memory artifacts must use a path owned by the maintenance lease."
        );
      const [existing] = await transaction
        .select()
        .from(memoryArtifacts)
        .where(
          and(
            eq(memoryArtifacts.workspaceId, scope.workspaceId),
            eq(memoryArtifacts.scopeKey, scopeKey),
            eq(memoryArtifacts.pathname, artifact.pathname)
          )
        )
        .limit(1);
      if (
        existing &&
        (existing.jobId !== jobId ||
          existing.sha256 !== artifact.sha256 ||
          existing.status !== "staged")
      )
        throw new Error("The memory artifact path is already in use.");
      await transaction
        .insert(memoryArtifacts)
        .values({
          workspaceId: scope.workspaceId,
          scopeKey,
          jobId,
          userId: scope.userId,
          ...artifact,
        })
        .onConflictDoUpdate({
          target: [
            memoryArtifacts.workspaceId,
            memoryArtifacts.scopeKey,
            memoryArtifacts.pathname,
          ],
          set: { status: "staged", createdAt: new Date() },
        });
    }
    return artifacts;
  });
}

export async function listPendingMemoryBlobPurges(
  limit = 25,
  workspaceIds?: readonly string[]
) {
  if (workspaceIds?.length === 0) return [];
  const rows = await db
    .select({ artifact: memoryArtifacts })
    .from(memoryArtifacts)
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, memoryArtifacts.workspaceId),
        eq(workspaceMemberships.userId, memoryArtifacts.userId)
      )
    )
    .leftJoin(memoryJobs, eq(memoryJobs.id, memoryArtifacts.jobId))
    .where(
      and(
        workspaceIds
          ? inArray(memoryArtifacts.workspaceId, [...workspaceIds])
          : undefined,
        lt(memoryArtifacts.createdAt, new Date(Date.now() - 5 * 60_000)),
        or(
          isNull(workspaceMemberships.userId),
          eq(memoryArtifacts.status, "purge"),
          and(
            eq(memoryArtifacts.status, "staged"),
            lt(memoryArtifacts.createdAt, new Date(Date.now() - 30 * 60_000)),
            sql`NOT COALESCE((${memoryJobs.status} = 'running' AND ${memoryJobs.leaseExpiresAt} > now()), false)`
          )
        )
      )
    )
    .orderBy(asc(memoryArtifacts.createdAt))
    .limit(z.number().int().min(1).max(100).parse(limit));
  return rows.map(({ artifact }) =>
    Object.assign(artifact, {
      scope: { workspaceId: artifact.workspaceId, userId: artifact.userId },
    })
  );
}

export async function completeMemoryBlobPurge(
  scope: AccessScope,
  scopeKey: string,
  pathname: string
) {
  await db
    .delete(memoryArtifacts)
    .where(
      and(
        eq(memoryArtifacts.workspaceId, scope.workspaceId),
        eq(memoryArtifacts.scopeKey, scopeKey),
        eq(memoryArtifacts.pathname, pathname),
        eq(memoryArtifacts.status, "purge")
      )
    );
}

export async function claimMemoryBlobPurge(
  scope: AccessScope,
  scopeKey: string,
  pathname: string
) {
  return db.transaction(async (transaction) => {
    const [artifact] = await transaction
      .select()
      .from(memoryArtifacts)
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey),
          eq(memoryArtifacts.pathname, pathname)
        )
      )
      .limit(1)
      .for("update");
    if (!artifact || artifact.createdAt.getTime() > Date.now() - 5 * 60_000)
      return null;
    const [member] = await transaction
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, artifact.workspaceId),
          eq(workspaceMemberships.userId, artifact.userId)
        )
      )
      .limit(1);
    if (artifact.status === "published" && member) return null;
    if (artifact.status === "staged" && member) {
      if (artifact.createdAt.getTime() > Date.now() - 30 * 60_000) return null;
      const [job] = await transaction
        .select()
        .from(memoryJobs)
        .where(eq(memoryJobs.id, artifact.jobId))
        .limit(1);
      if (
        job?.status === "running" &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt > new Date()
      )
        return null;
    }
    await transaction
      .update(memoryArtifacts)
      .set({ status: "purge" })
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey),
          eq(memoryArtifacts.pathname, pathname)
        )
      );
    return artifact;
  });
}

/* oxlint-disable eslint/no-await-in-loop -- Transaction mutations and validations must follow their dependent writes. */
import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  memoryArtifacts,
  memoryGenerations,
  memoryJobs,
  memoryLinks,
  memoryRecallResults,
  memoryRecords,
  memoryRevisions,
  memorySources,
  memoryState,
} from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import type { MemoryTransaction } from "./scope";

export async function purgeMemoryContent(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  input: {
    recordIds?: readonly string[];
    sourceIds?: readonly string[];
    operationId: string;
    forgetBefore?: Date;
  }
) {
  const records = await transaction
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.workspaceId, scope.workspaceId),
        eq(memoryRecords.scopeKey, scopeKey),
        isNotNull(memoryRecords.content)
      )
    );
  const revisions = await transaction
    .select()
    .from(memoryRevisions)
    .where(
      and(
        eq(memoryRevisions.workspaceId, scope.workspaceId),
        eq(memoryRevisions.scopeKey, scopeKey)
      )
    );
  const sourceIds = new Set(input.sourceIds ?? []);
  if (input.forgetBefore) {
    const supportedSources = new Set(
      [...records, ...revisions].flatMap(
        (row) => row.content?.evidence.map((span) => span.sourceId) ?? []
      )
    );
    const pending = await transaction
      .select({ id: memorySources.id, status: memorySources.status })
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          or(
            inArray(memorySources.status, ["pending", "failed"]),
            and(
              eq(memorySources.kind, "user"),
              eq(memorySources.status, "processed")
            )
          ),
          lte(memorySources.observedAt, input.forgetBefore)
        )
      );
    for (const source of pending)
      if (source.status !== "processed" || !supportedSources.has(source.id))
        sourceIds.add(source.id);
  }
  const affected = new Set(input.recordIds ?? []);
  let changed = true;
  while (changed) {
    const previous = sourceIds.size + affected.size;
    for (const record of records) {
      const evidence = [
        record.content,
        ...revisions
          .filter((revision) => revision.recordId === record.id)
          .map((revision) => revision.content),
      ].flatMap((content) => content?.evidence ?? []);
      if (
        affected.has(record.id) ||
        evidence.some((span) => sourceIds.has(span.sourceId))
      ) {
        affected.add(record.id);
        for (const span of evidence) sourceIds.add(span.sourceId);
      }
    }
    changed = sourceIds.size + affected.size !== previous;
  }
  if (sourceIds.size)
    await transaction
      .update(memorySources)
      .set({
        text: null,
        reference: null,
        sessionId: null,
        turnId: null,
        status: "forgotten",
      })
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey),
          inArray(memorySources.id, [...sourceIds])
        )
      );
  if (affected.size > 0) {
    const ids = [...affected];
    await transaction
      .delete(memoryRevisions)
      .where(
        and(
          eq(memoryRevisions.workspaceId, scope.workspaceId),
          eq(memoryRevisions.scopeKey, scopeKey),
          inArray(memoryRevisions.recordId, ids)
        )
      );
    await transaction
      .delete(memoryLinks)
      .where(
        and(
          eq(memoryLinks.workspaceId, scope.workspaceId),
          eq(memoryLinks.scopeKey, scopeKey),
          or(inArray(memoryLinks.fromId, ids), inArray(memoryLinks.toId, ids))
        )
      );
    for (const id of ids) {
      const current = records.find((record) => record.id === id);
      await transaction
        .insert(memoryRecords)
        .values({
          workspaceId: scope.workspaceId,
          scopeKey,
          id,
          revision: (current?.revision ?? 0) + 1,
          content: null,
          lastOperationId: input.operationId,
        })
        .onConflictDoUpdate({
          target: [
            memoryRecords.workspaceId,
            memoryRecords.scopeKey,
            memoryRecords.id,
          ],
          set: {
            content: null,
            explicit: false,
            revision: (current?.revision ?? 0) + 1,
            lastOperationId: input.operationId,
            updatedAt: new Date(),
          },
        });
    }
  }
  await transaction
    .update(memoryArtifacts)
    .set({ status: "purge" })
    .where(
      and(
        eq(memoryArtifacts.workspaceId, scope.workspaceId),
        eq(memoryArtifacts.scopeKey, scopeKey)
      )
    );
  await transaction
    .delete(memoryGenerations)
    .where(
      and(
        eq(memoryGenerations.workspaceId, scope.workspaceId),
        eq(memoryGenerations.scopeKey, scopeKey)
      )
    );
  await transaction
    .update(memoryRecallResults)
    .set({ result: null, invalidated: true })
    .where(
      and(
        eq(memoryRecallResults.workspaceId, scope.workspaceId),
        eq(memoryRecallResults.scopeKey, scopeKey)
      )
    );
  await transaction
    .update(memoryJobs)
    .set({
      checkpoint: null,
      status: "cancelled",
      leaseToken: null,
      leaseExpiresAt: null,
      sourceVersions: [],
    })
    .where(
      and(
        eq(memoryJobs.workspaceId, scope.workspaceId),
        eq(memoryJobs.scopeKey, scopeKey)
      )
    );
  const [state] = await transaction
    .select()
    .from(memoryState)
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
      )
    )
    .limit(1);
  if (!state) throw new Error("Memory state is unavailable.");
  await transaction
    .update(memoryState)
    .set({
      deletionEpoch: state.deletionEpoch + 1,
      inputRevision: state.inputRevision + 1,
      forgetBefore: input.forgetBefore ?? state.forgetBefore,
    })
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
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
  if (pending || records.some((record) => !affected.has(record.id)))
    await transaction.insert(memoryJobs).values({
      workspaceId: scope.workspaceId,
      scopeKey,
      requestedByUserId: scope.userId,
      epoch: state.deletionEpoch + 1,
    });
  return {
    forgotten: true,
    recordIds: [...affected],
    deletionEpoch: state.deletionEpoch + 1,
  };
}

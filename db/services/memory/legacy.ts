/* oxlint-disable eslint/no-await-in-loop -- Transaction mutations and validations must follow their dependent writes. */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, memoryLegacyImports, memorySources } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { eligibleKnowledgeText } from "@shared/memory/policy";
import {
  lockMemoryState,
  requireMemoryMembership,
  type MemoryTransaction,
} from "./scope";
import { enqueueMemoryJob, insertMemorySources } from "./sources";
import { writeMemoryRecord } from "./records";
import { publishMemoryGeneration } from "./generations";

export async function readLegacyMemoryImport(
  scope: AccessScope,
  legacyScopeKey: string,
  transaction?: MemoryTransaction
) {
  const database = transaction ?? db;
  await requireMemoryMembership(scope, database);
  const [marker] = await database
    .select({ scopeKey: memoryLegacyImports.scopeKey })
    .from(memoryLegacyImports)
    .where(
      and(
        eq(memoryLegacyImports.workspaceId, scope.workspaceId),
        eq(memoryLegacyImports.legacyScopeKey, legacyScopeKey)
      )
    )
    .limit(1);
  return marker ?? null;
}

export async function importLegacyMemory(
  scope: AccessScope,
  scopeKey: string,
  value: {
    legacyScopeKey: string;
    entries: readonly { index: number; text: string }[];
  },
  existingTransaction?: MemoryTransaction
) {
  const input = z
    .strictObject({
      legacyScopeKey: z.string().min(1).max(1_024),
      entries: z
        .array(
          z.strictObject({
            index: z.number().int().nonnegative(),
            text: z.string().trim().min(1).max(3_000),
          })
        )
        .max(1_000),
    })
    .parse(value);
  const applyImport = async (transaction: MemoryTransaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const [existing] = await transaction
      .select()
      .from(memoryLegacyImports)
      .where(
        and(
          eq(memoryLegacyImports.workspaceId, scope.workspaceId),
          eq(memoryLegacyImports.legacyScopeKey, input.legacyScopeKey)
        )
      )
      .limit(1);
    if (existing) return { scopeKey: existing.scopeKey, imported: 0 };
    let imported = 0;
    if (!state.forgetBefore)
      for (const entry of input.entries) {
        if (!eligibleKnowledgeText(entry.text)) continue;
        const identity = createHash("sha256")
          .update(`${input.legacyScopeKey}:${String(entry.index)}`)
          .digest("hex");
        const sourceId = `legacy-${identity}`;
        const recordId = `preference-${identity}`;
        await insertMemorySources(transaction, scope, scopeKey, [
          {
            id: sourceId,
            kind: "legacy",
            text: entry.text,
            reference: `Legacy profile entry ${String(entry.index)}; original source and date unknown`,
            observedAt: new Date().toISOString(),
          },
        ]);
        await writeMemoryRecord(
          transaction,
          scope,
          scopeKey,
          {
            id: recordId,
            expectedRevision: 0,
            content: {
              kind: "preference",
              title: "Imported preference",
              body: entry.text,
              evidence: [{ sourceId, start: 0, end: entry.text.length }],
            },
          },
          `legacy:${identity}`,
          false
        );
        await transaction
          .update(memorySources)
          .set({ status: "processed" })
          .where(
            and(
              eq(memorySources.workspaceId, scope.workspaceId),
              eq(memorySources.scopeKey, scopeKey),
              eq(memorySources.id, sourceId)
            )
          );
        imported += 1;
      }
    await transaction.insert(memoryLegacyImports).values({
      workspaceId: scope.workspaceId,
      scopeKey,
      legacyScopeKey: input.legacyScopeKey,
    });
    await publishMemoryGeneration(transaction, scope, scopeKey);
    if (imported)
      await enqueueMemoryJob(
        transaction,
        scope,
        scopeKey,
        state.deletionEpoch,
        true
      );
    return { scopeKey, imported };
  };
  return existingTransaction
    ? applyImport(existingTransaction)
    : db.transaction(applyImport);
}

export async function withLegacyMemoryLock<Result>(
  scope: AccessScope,
  legacyScopeKey: string,
  operation: (transaction: MemoryTransaction) => Promise<Result>
) {
  return db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, legacyScopeKey);
    return operation(transaction);
  });
}

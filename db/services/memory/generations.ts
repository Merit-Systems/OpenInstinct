import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { z } from "zod";
import { db, memoryGenerations, memoryRecallResults, memoryRecords } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { memoryRecallSchema } from "@shared/memory/schema";
import { lockMemoryState, requireMemoryMembership } from "./scope";

export { publishMemoryGeneration } from "./projection";
import { projectRecords } from "./projection";

export async function readMemoryGeneration(
  scope: AccessScope,
  scopeKey: string
) {
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    const [generation] = await transaction
      .select()
      .from(memoryGenerations)
      .where(
        and(
          eq(memoryGenerations.workspaceId, scope.workspaceId),
          eq(memoryGenerations.scopeKey, scopeKey),
          eq(memoryGenerations.generation, state.generation)
        )
      )
      .limit(1);
    if (!generation)
      return {
        generation: state.generation,
        deletionEpoch: state.deletionEpoch,
        profile: "",
        currentContext: "",
        recordIds: [],
      };
    const rows = await transaction
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.workspaceId, scope.workspaceId),
          eq(memoryRecords.scopeKey, scopeKey),
          isNotNull(memoryRecords.content)
        )
      )
      .orderBy(
        desc(memoryRecords.explicit),
        desc(memoryRecords.updatedAt),
        memoryRecords.id
      );
    return { ...generation, ...projectRecords(rows) };
  });
}

export async function readMemoryRecall(
  scope: AccessScope,
  scopeKey: string,
  operationId: string
) {
  await requireMemoryMembership(scope);
  const [cached] = await db
    .select()
    .from(memoryRecallResults)
    .where(
      and(
        eq(memoryRecallResults.workspaceId, scope.workspaceId),
        eq(memoryRecallResults.scopeKey, scopeKey),
        eq(memoryRecallResults.operationId, operationId)
      )
    )
    .limit(1);
  if (cached?.invalidated)
    throw new Error(
      "This memory operation was invalidated by forgetting. Start a new turn."
    );
  return cached?.result
    ? { result: cached.result, deletionEpoch: cached.deletionEpoch }
    : null;
}

export async function saveMemoryRecall(
  scope: AccessScope,
  scopeKey: string,
  operationId: string,
  expectedEpoch: number,
  result: z.input<typeof memoryRecallSchema>
) {
  const parsed = memoryRecallSchema.parse(result);
  return db.transaction(async (transaction) => {
    const state = await lockMemoryState(transaction, scope, scopeKey);
    if (state.deletionEpoch !== expectedEpoch)
      throw new Error(
        "Memory changed while preparing recall. Start a new turn."
      );
    const [existing] = await transaction
      .select()
      .from(memoryRecallResults)
      .where(
        and(
          eq(memoryRecallResults.workspaceId, scope.workspaceId),
          eq(memoryRecallResults.scopeKey, scopeKey),
          eq(memoryRecallResults.operationId, operationId)
        )
      )
      .limit(1);
    if (existing?.invalidated)
      throw new Error(
        "This memory operation was invalidated by forgetting. Start a new turn."
      );
    if (existing?.result) return existing.result;
    await transaction.insert(memoryRecallResults).values({
      workspaceId: scope.workspaceId,
      scopeKey,
      operationId,
      deletionEpoch: expectedEpoch,
      result: parsed,
    });
    return parsed;
  });
}

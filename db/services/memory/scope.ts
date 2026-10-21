import { and, asc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  agentSessions,
  db,
  memoryBindings,
  memorySources,
  memoryState,
  workspaceMemberships,
} from "@db";
import { purgeMemoryContent } from "./purge";
import { publishMemoryGeneration } from "./projection";
import type { AccessScope } from "@shared/identity/access-scope";

export type MemoryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export interface MemoryCaptureBoundary {
  turnId: string;
  observedAt: string;
}

export async function requireMemoryMembership(
  scope: AccessScope,
  database: typeof db | MemoryTransaction = db
) {
  const [member] = await database
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, scope.workspaceId),
        eq(workspaceMemberships.userId, scope.userId)
      )
    )
    .limit(1)
    .for("share");
  if (!member)
    throw new Error("Memory workspace access is no longer available.");
}

export async function lockMemoryState(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string
) {
  z.string().min(1).max(1_024).parse(scopeKey);
  await requireMemoryMembership(scope, transaction);
  await transaction
    .insert(memoryState)
    .values({ workspaceId: scope.workspaceId, scopeKey })
    .onConflictDoNothing();
  const [state] = await transaction
    .select()
    .from(memoryState)
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
      )
    )
    .limit(1)
    .for("update");
  if (!state) throw new Error("Memory state is unavailable.");
  return state;
}

export async function registerMemoryScope(
  scope: AccessScope,
  scopeKey: string,
  namespace: string,
  sessionId: string
) {
  z.string().min(1).max(1_024).parse(namespace);
  return db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, scopeKey);
    const [session] = await transaction
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.sessionId, sessionId),
          eq(agentSessions.workspaceId, scope.workspaceId),
          eq(agentSessions.createdByUserId, scope.userId)
        )
      )
      .limit(1);
    if (!session)
      throw new Error("The memory session does not belong to this workspace.");
    const [existing] = await transaction
      .select()
      .from(memoryBindings)
      .where(eq(memoryBindings.sessionId, sessionId))
      .limit(1);
    if (
      existing &&
      (existing.scopeKey !== scopeKey ||
        existing.namespace !== namespace ||
        existing.workspaceId !== scope.workspaceId)
    )
      throw new Error("The memory session is already bound to another scope.");
    const [binding] = await transaction
      .insert(memoryBindings)
      .values({
        workspaceId: scope.workspaceId,
        scopeKey,
        namespace,
        sessionId,
        userId: scope.userId,
      })
      .onConflictDoUpdate({
        target: memoryBindings.sessionId,
        set: { updatedAt: new Date() },
      })
      .returning();
    if (!binding) throw new Error("The memory session could not be bound.");
    return binding;
  });
}

export async function readMemoryBinding(
  scope: AccessScope,
  sessionId: string,
  transaction?: MemoryTransaction
) {
  const database = transaction ?? db;
  await requireMemoryMembership(scope, database);
  const [binding] = await database
    .select({ binding: memoryBindings })
    .from(memoryBindings)
    .innerJoin(
      agentSessions,
      eq(agentSessions.sessionId, memoryBindings.sessionId)
    )
    .where(
      and(
        eq(memoryBindings.sessionId, sessionId),
        eq(memoryBindings.workspaceId, scope.workspaceId),
        eq(memoryBindings.userId, scope.userId),
        eq(agentSessions.workspaceId, scope.workspaceId),
        eq(agentSessions.createdByUserId, scope.userId)
      )
    )
    .limit(1);
  return binding?.binding ?? null;
}

export async function listMemoryBindings(scope: AccessScope) {
  const rows = await db
    .select({ binding: memoryBindings })
    .from(memoryBindings)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, memoryBindings.workspaceId),
        eq(workspaceMemberships.userId, memoryBindings.userId)
      )
    )
    .innerJoin(
      agentSessions,
      eq(agentSessions.sessionId, memoryBindings.sessionId)
    )
    .where(
      and(
        eq(memoryBindings.workspaceId, scope.workspaceId),
        eq(memoryBindings.userId, scope.userId),
        eq(agentSessions.workspaceId, scope.workspaceId),
        eq(agentSessions.createdByUserId, scope.userId)
      )
    )
    .orderBy(asc(memoryBindings.namespace), asc(memoryBindings.sessionId))
    .limit(100);
  return rows.map(({ binding }) => binding);
}

export async function listMemorySessionBindings(
  limit = 25,
  workspaceIds?: readonly string[]
) {
  if (workspaceIds?.length === 0) return [];
  const rows = await db
    .select({ binding: memoryBindings })
    .from(memoryBindings)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, memoryBindings.workspaceId),
        eq(workspaceMemberships.userId, memoryBindings.userId)
      )
    )
    .innerJoin(
      agentSessions,
      and(
        eq(agentSessions.sessionId, memoryBindings.sessionId),
        eq(agentSessions.workspaceId, memoryBindings.workspaceId),
        eq(agentSessions.createdByUserId, memoryBindings.userId)
      )
    )
    .where(
      workspaceIds
        ? inArray(memoryBindings.workspaceId, [...workspaceIds])
        : undefined
    )
    .orderBy(asc(memoryBindings.updatedAt), asc(memoryBindings.sessionId))
    .limit(z.number().int().min(1).max(100).parse(limit));
  return rows.map(({ binding }) =>
    Object.assign(binding, {
      scope: { workspaceId: binding.workspaceId, userId: binding.userId },
    })
  );
}

export async function disableMemorySessionCapture(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string,
  sessionId: string,
  boundary: MemoryCaptureBoundary
) {
  z.string().min(1).parse(boundary.turnId);
  const observedAt = new Date(z.iso.datetime().parse(boundary.observedAt));
  const [binding] = await transaction
    .select()
    .from(memoryBindings)
    .where(
      and(
        eq(memoryBindings.workspaceId, scope.workspaceId),
        eq(memoryBindings.scopeKey, scopeKey),
        eq(memoryBindings.sessionId, sessionId),
        eq(memoryBindings.userId, scope.userId)
      )
    )
    .limit(1);
  if (!binding) return;
  await transaction
    .update(memoryBindings)
    .set({ captureDisabled: true })
    .where(
      and(
        eq(memoryBindings.workspaceId, scope.workspaceId),
        eq(memoryBindings.scopeKey, scopeKey),
        eq(memoryBindings.sessionId, sessionId)
      )
    );
  const sources = await transaction
    .select({ id: memorySources.id })
    .from(memorySources)
    .where(
      and(
        eq(memorySources.workspaceId, scope.workspaceId),
        eq(memorySources.scopeKey, scopeKey),
        eq(memorySources.sessionId, sessionId),
        eq(memorySources.kind, "user"),
        isNotNull(memorySources.text),
        or(
          eq(memorySources.turnId, boundary.turnId),
          gte(memorySources.observedAt, observedAt)
        )
      )
    );
  if (sources.length === 0) return;
  await purgeMemoryContent(transaction, scope, scopeKey, {
    sourceIds: sources.map((source) => source.id),
    operationId: `disable:${sessionId}`,
  });
  await publishMemoryGeneration(transaction, scope, scopeKey);
}

export async function setMemoryCaptureDisabled(
  scope: AccessScope,
  scopeKey: string,
  sessionId: string,
  boundary: MemoryCaptureBoundary
) {
  await db.transaction(async (transaction) => {
    await lockMemoryState(transaction, scope, scopeKey);
    await disableMemorySessionCapture(
      transaction,
      scope,
      scopeKey,
      sessionId,
      boundary
    );
  });
}

export async function readMemoryState(scope: AccessScope, scopeKey: string) {
  await requireMemoryMembership(scope);
  const [state] = await db
    .select()
    .from(memoryState)
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
      )
    )
    .limit(1);
  return (
    state ?? {
      workspaceId: scope.workspaceId,
      scopeKey,
      deletionEpoch: 0,
      generation: 0,
      inputRevision: 0,
      forgetBefore: null,
    }
  );
}

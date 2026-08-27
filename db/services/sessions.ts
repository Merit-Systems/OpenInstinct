import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { agentSessions, db } from "@/db";

export async function claimSession(scope: AccessScope, sessionId: string) {
  await db
    .insert(agentSessions)
    .values({
      createdAt: new Date().toISOString(),
      createdByUserId: scope.userId,
      sessionId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoNothing({ target: agentSessions.sessionId });
}

export async function isSessionOwned(scope: AccessScope, sessionId: string) {
  const rows = await db
    .select({ sessionId: agentSessions.sessionId })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.workspaceId, scope.workspaceId),
        eq(agentSessions.sessionId, sessionId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function listOwnedSessionIds(scope: AccessScope) {
  const rows = await db
    .select({ sessionId: agentSessions.sessionId })
    .from(agentSessions)
    .where(eq(agentSessions.workspaceId, scope.workspaceId));
  return new Set(rows.map((row) => row.sessionId));
}

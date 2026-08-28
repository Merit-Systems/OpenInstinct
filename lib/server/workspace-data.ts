import { and, desc, eq } from "drizzle-orm";
import type { AccessScope } from "../access-scope";
import {
  agentSessions,
  browserSessions,
  workspaceMemberships,
  workspaces,
} from "../db/schema";
import { database } from "./database";

export async function ensureWorkspace(scope: AccessScope) {
  const currentDatabase = database();
  const now = new Date().toISOString();
  await currentDatabase.batch([
    currentDatabase
      .insert(workspaces)
      .values({ createdAt: now, id: scope.workspaceId })
      .onConflictDoNothing(),
    currentDatabase
      .insert(workspaceMemberships)
      .values({
        createdAt: now,
        role: "owner",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      .onConflictDoNothing(),
  ]);
}

export async function claimAgentSession(scope: AccessScope, sessionId: string) {
  await database()
    .insert(agentSessions)
    .values({
      createdAt: new Date().toISOString(),
      createdByUserId: scope.userId,
      sessionId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoNothing();
}

export async function isAgentSessionOwned(
  scope: AccessScope,
  sessionId: string
) {
  const row = await database().query.agentSessions.findFirst({
    columns: { sessionId: true },
    where: and(
      eq(agentSessions.workspaceId, scope.workspaceId),
      eq(agentSessions.sessionId, sessionId)
    ),
  });
  return row !== undefined;
}

export async function listOwnedAgentSessionIds(scope: AccessScope) {
  const rows = await database()
    .select({ sessionId: agentSessions.sessionId })
    .from(agentSessions)
    .where(eq(agentSessions.workspaceId, scope.workspaceId));
  return new Set(rows.map((row) => row.sessionId));
}

export async function createBrowserSession(
  scope: AccessScope,
  record: Pick<typeof browserSessions.$inferInsert, "createdAt" | "sessionId">
) {
  await database()
    .insert(browserSessions)
    .values({
      ...record,
      createdByUserId: scope.userId,
      workspaceId: scope.workspaceId,
    });
}

export async function deleteBrowserSession(
  scope: AccessScope,
  sessionId: string
) {
  const rows = await database()
    .delete(browserSessions)
    .where(
      and(
        eq(browserSessions.workspaceId, scope.workspaceId),
        eq(browserSessions.sessionId, sessionId)
      )
    )
    .returning({ sessionId: browserSessions.sessionId });
  return rows.length > 0;
}

export async function listBrowserSessions(scope: AccessScope) {
  return database()
    .select({
      createdAt: browserSessions.createdAt,
      sessionId: browserSessions.sessionId,
    })
    .from(browserSessions)
    .where(eq(browserSessions.workspaceId, scope.workspaceId))
    .orderBy(desc(browserSessions.createdAt));
}

export async function readBrowserSession(
  scope: AccessScope,
  sessionId: string
) {
  return database().query.browserSessions.findFirst({
    columns: { createdAt: true, sessionId: true },
    where: and(
      eq(browserSessions.workspaceId, scope.workspaceId),
      eq(browserSessions.sessionId, sessionId)
    ),
  });
}

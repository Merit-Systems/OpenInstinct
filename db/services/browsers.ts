import { and, desc, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { browserSessions, db } from "@/db";

type BrowserSessionRecord = Pick<
  typeof browserSessions.$inferSelect,
  "createdAt" | "sessionId"
>;

export async function createBrowserSession(
  scope: AccessScope,
  record: BrowserSessionRecord
) {
  await db.insert(browserSessions).values({
    createdAt: record.createdAt,
    createdByUserId: scope.userId,
    sessionId: record.sessionId,
    workspaceId: scope.workspaceId,
  });
}

export async function listBrowserSessions(scope: AccessScope) {
  return db
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
  const rows = await db
    .select({
      createdAt: browserSessions.createdAt,
      sessionId: browserSessions.sessionId,
    })
    .from(browserSessions)
    .where(
      and(
        eq(browserSessions.workspaceId, scope.workspaceId),
        eq(browserSessions.sessionId, sessionId)
      )
    )
    .limit(1);
  return rows[0];
}

export async function deleteBrowserSession(
  scope: AccessScope,
  sessionId: string
) {
  const rows = await db
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

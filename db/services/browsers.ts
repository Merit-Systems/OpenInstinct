import { and, desc, eq, sql } from "drizzle-orm";
import type { BrowserRefState } from "@onkernel/browser-loop";
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

export async function withBrowserRefState<T>(
  scope: AccessScope,
  sessionId: string,
  operation: (
    refState: BrowserRefState | undefined
  ) => Promise<{ refState: BrowserRefState; result: T }>
) {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ refState: browserSessions.refState })
      .from(browserSessions)
      .where(
        and(
          eq(browserSessions.workspaceId, scope.workspaceId),
          eq(browserSessions.sessionId, sessionId)
        )
      )
      .limit(1)
      .for("update");
    const record = rows[0];
    if (!record) {
      throw new Error("The browser session is not owned by this workspace.");
    }

    const outcome = await operation(record.refState ?? undefined);
    await transaction
      .update(browserSessions)
      .set({ refState: outcome.refState })
      .where(
        and(
          eq(browserSessions.workspaceId, scope.workspaceId),
          eq(browserSessions.sessionId, sessionId)
        )
      );
    return outcome.result;
  });
}

export async function withBrowserProfileWriteLock<T>(
  scope: AccessScope,
  operation: () => Promise<T>
) {
  return db.transaction(async (transaction) => {
    const result = await transaction.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${scope.workspaceId}, 0)) AS "acquired"`
    );
    if (result.rows[0]?.acquired !== true) {
      throw new Error(
        "Another browser profile update is starting for this workspace. Retry after it finishes."
      );
    }
    return operation();
  });
}

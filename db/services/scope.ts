import type { AccessScope } from "@/lib/access-scope";
import { db, workspaceMemberships, workspaces } from "@/db";

export async function ensureScope(scope: AccessScope) {
  const createdAt = new Date().toISOString();
  await db.transaction(async (transaction) => {
    await transaction
      .insert(workspaces)
      .values({ createdAt, id: scope.workspaceId })
      .onConflictDoNothing({ target: workspaces.id });
    await transaction
      .insert(workspaceMemberships)
      .values({
        createdAt,
        role: "owner",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      .onConflictDoNothing({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      });
  });
}

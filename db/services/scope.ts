import type { AccessScope } from "@/lib/access-scope";
import { db, workspaceMemberships, workspaces } from "@/db";

export async function ensureScope(scope: AccessScope) {
  const createdAt = new Date().toISOString();
  await db.batch([
    db
      .insert(workspaces)
      .values({ createdAt, id: scope.workspaceId })
      .onConflictDoNothing({ target: workspaces.id }),
    db
      .insert(workspaceMemberships)
      .values({
        createdAt,
        role: "owner",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      .onConflictDoNothing({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      }),
  ]);
}

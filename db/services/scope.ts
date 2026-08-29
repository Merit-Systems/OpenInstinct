import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import {
  db,
  workspaceMembershipRoles,
  workspaceMemberships,
  workspaces,
  type WorkspaceMembershipRole,
  type WorkspaceMembershipStatus,
} from "@/db";
import { isWorkspaceScopeEnforcementEnabled } from "@/lib/env";

export class WorkspaceNotOperableError extends Error {
  constructor(readonly lifecycleState: string | undefined) {
    super("This workspace is not currently operable.");
    this.name = "WorkspaceNotOperableError";
  }
}

export type VerifiedAccessScope = AccessScope & {
  readonly membershipStatus: WorkspaceMembershipStatus;
  readonly role: WorkspaceMembershipRole;
};

export async function verifyScopeAccess(
  scope: AccessScope
): Promise<VerifiedAccessScope | undefined> {
  const [row] = await db
    .select({
      lifecycleState: workspaces.lifecycleState,
      membershipStatus: workspaceMemberships.status,
      role: workspaceMemberships.role,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, workspaces.id),
        eq(workspaceMemberships.userId, scope.userId)
      )
    )
    .where(eq(workspaces.id, scope.workspaceId))
    .limit(1);

  if (!row) {
    return { ...scope, membershipStatus: "active", role: "owner" };
  }
  if (
    (row.lifecycleState !== "trial" && row.lifecycleState !== "active") ||
    row.membershipStatus !== "active" ||
    !isWorkspaceMembershipRole(row.role)
  ) {
    return;
  }

  return { ...scope, membershipStatus: row.membershipStatus, role: row.role };
}

function isWorkspaceMembershipRole(
  value: string | null
): value is WorkspaceMembershipRole {
  return (
    value !== null &&
    (workspaceMembershipRoles as readonly string[]).includes(value)
  );
}

export async function ensureScope(scope: AccessScope) {
  const createdAt = new Date().toISOString();
  await db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(workspaces)
      .values({ createdAt, id: scope.workspaceId })
      .onConflictDoNothing({ target: workspaces.id })
      .returning({ id: workspaces.id });
    if (!workspace) return;
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

export async function assertWorkspaceOperable(scope: AccessScope) {
  if (!isWorkspaceScopeEnforcementEnabled()) return;
  const [workspace] = await db
    .select({ lifecycleState: workspaces.lifecycleState })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId))
    .limit(1);

  // A deterministic first-run scope has not been provisioned yet; preserve the
  // same admission behavior as verifyScopeAccess until ensureScope creates it.
  if (!workspace) return;
  if (
    workspace.lifecycleState !== "trial" &&
    workspace.lifecycleState !== "active"
  ) {
    throw new WorkspaceNotOperableError(workspace.lifecycleState);
  }
}

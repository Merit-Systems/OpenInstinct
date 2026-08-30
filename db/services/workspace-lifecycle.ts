import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import {
  agentSessions,
  agentRevisions,
  agents,
  auditEvents,
  browserImageArtifacts,
  browserSessions,
  channelConversations,
  channelParticipants,
  chats,
  connectionInstallations,
  db,
  encryptedSecrets,
  settings,
  vaultItems,
  workspaceBudgets,
  workspaceLifecycleStates,
  workspaceMemberships,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  workspaces,
  type WorkspaceLifecycleState,
} from "@/db";
import { emitWebhookEvent } from "./webhooks";

export class WorkspaceLifecycleTransitionError extends Error {
  constructor(
    readonly from: WorkspaceLifecycleState | undefined,
    readonly to: WorkspaceLifecycleState
  ) {
    super("This workspace lifecycle transition is not allowed.");
    this.name = "WorkspaceLifecycleTransitionError";
  }
}

export class WorkspaceLifecycleAuthorizationError extends Error {
  constructor() {
    super("Only workspace owners can change the workspace lifecycle.");
    this.name = "WorkspaceLifecycleAuthorizationError";
  }
}

const allowedTransitions: Partial<
  Record<WorkspaceLifecycleState, readonly WorkspaceLifecycleState[]>
> = {
  active: ["suspended", "pending_deletion"],
  pending_deletion: [],
  suspended: ["active", "pending_deletion"],
  trial: ["active", "suspended"],
};

function isWorkspaceLifecycleState(
  value: string | undefined
): value is WorkspaceLifecycleState {
  return (
    value !== undefined &&
    workspaceLifecycleStates.some((state) => state === value)
  );
}

function lifecycleAuditAction(
  from: WorkspaceLifecycleState,
  to: WorkspaceLifecycleState
) {
  if (to === "active")
    return from === "trial" ? "workspace.activate" : "workspace.reactivate";
  if (to === "suspended") return "workspace.suspend";
  if (to === "pending_deletion") return "workspace.pending_deletion";
  return "workspace.delete";
}

export async function transitionWorkspaceLifecycle(
  scope: AccessScope,
  to: WorkspaceLifecycleState
) {
  const now = new Date().toISOString();
  return db.transaction(async (transaction) => {
    const [membership] = await transaction
      .select({
        role: workspaceMemberships.role,
        status: workspaceMemberships.status,
      })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, scope.workspaceId),
          eq(workspaceMemberships.userId, scope.userId)
        )
      )
      .limit(1);
    if (membership?.role !== "owner" || membership.status !== "active") {
      throw new WorkspaceLifecycleAuthorizationError();
    }

    const [workspace] = await transaction
      .select({ lifecycleState: workspaces.lifecycleState })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId))
      .for("update")
      .limit(1);
    const candidate = workspace?.lifecycleState;
    const from = isWorkspaceLifecycleState(candidate) ? candidate : undefined;
    if (!from || !allowedTransitions[from]?.includes(to)) {
      throw new WorkspaceLifecycleTransitionError(from, to);
    }

    const [updated] = await transaction
      .update(workspaces)
      .set({ lifecycleState: to, updatedAt: now })
      .where(
        and(
          eq(workspaces.id, scope.workspaceId),
          eq(workspaces.lifecycleState, from)
        )
      )
      .returning({ id: workspaces.id });
    if (!updated) throw new WorkspaceLifecycleTransitionError(from, to);
    const webhookEventType = lifecycleWebhookEventType(from, to);
    if (webhookEventType) {
      await emitWebhookEvent(transaction, scope, {
        payload: { lifecycleState: to, workspaceId: scope.workspaceId },
        type: webhookEventType,
      });
    }
    await transaction.insert(auditEvents).values({
      action: lifecycleAuditAction(from, to),
      actorUserId: scope.userId,
      createdAt: now,
      id: randomUUID(),
      metadata: { from, to },
      outcome: "ok",
      target: scope.workspaceId,
      workspaceId: scope.workspaceId,
    });
  });
}

/**
 * Cross-workspace administrative transition.  Keep this separate from the
 * membership-checked owner path above: callers must already be deployment
 * administrators, and the audit actor is the administrator rather than a
 * workspace member.
 */
export async function adminTransitionWorkspaceLifecycle(
  actorUserId: string,
  workspaceId: string,
  to: WorkspaceLifecycleState
) {
  const now = new Date().toISOString();
  return db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .select({ lifecycleState: workspaces.lifecycleState })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update")
      .limit(1);
    const candidate = workspace?.lifecycleState;
    const from = isWorkspaceLifecycleState(candidate) ? candidate : undefined;
    if (!from || !allowedTransitions[from]?.includes(to)) {
      throw new WorkspaceLifecycleTransitionError(from, to);
    }

    const [updated] = await transaction
      .update(workspaces)
      .set({ lifecycleState: to, updatedAt: now })
      .where(
        and(eq(workspaces.id, workspaceId), eq(workspaces.lifecycleState, from))
      )
      .returning({ id: workspaces.id });
    if (!updated) throw new WorkspaceLifecycleTransitionError(from, to);
    const webhookEventType = lifecycleWebhookEventType(from, to);
    if (webhookEventType) {
      await emitWebhookEvent(
        transaction,
        { userId: actorUserId, workspaceId },
        {
          payload: { lifecycleState: to, workspaceId },
          type: webhookEventType,
        }
      );
    }
    await transaction.insert(auditEvents).values({
      action: "admin.workspace_lifecycle",
      actorUserId,
      createdAt: now,
      id: randomUUID(),
      metadata: { from, to },
      outcome: "ok",
      target: workspaceId,
      workspaceId,
    });
  });
}

function lifecycleWebhookEventType(
  from: WorkspaceLifecycleState,
  to: WorkspaceLifecycleState
) {
  if (to === "suspended") return "workspace.suspended" as const;
  if (to === "pending_deletion") return "workspace.deletion_started" as const;
  if (from === "suspended" && to === "active")
    return "workspace.reactivated" as const;
  return;
}

export async function deleteWorkspaceData(scope: AccessScope) {
  const { workspaceId } = scope;
  const now = new Date().toISOString();
  return db.transaction(async (transaction) => {
    const [membership] = await transaction
      .select({
        role: workspaceMemberships.role,
        status: workspaceMemberships.status,
      })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, scope.userId)
        )
      )
      .limit(1);
    if (membership?.role !== "owner" || membership.status !== "active") {
      throw new WorkspaceLifecycleAuthorizationError();
    }

    const [workspace] = await transaction
      .select({ lifecycleState: workspaces.lifecycleState })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update")
      .limit(1);
    const candidate = workspace?.lifecycleState;
    const lifecycleState = isWorkspaceLifecycleState(candidate)
      ? candidate
      : undefined;
    if (lifecycleState !== "pending_deletion") {
      throw new WorkspaceLifecycleTransitionError(lifecycleState, "deleted");
    }

    const conversationIds = (
      await transaction
        .select({ id: channelConversations.id })
        .from(channelConversations)
        .where(eq(channelConversations.workspaceId, workspaceId))
    ).map((row) => row.id);

    const counts = {
      agentRevisions: 0,
      agentSessions: 0,
      agents: 0,
      browserImageArtifacts: 0,
      browserSessions: 0,
      channelConversations: 0,
      channelParticipants: 0,
      chats: 0,
      connectionInstallations: 0,
      encryptedSecrets: 0,
      settings: 0,
      vaultItems: 0,
      webhookDeliveries: 0,
      webhookEndpoints: 0,
      webhookEvents: 0,
      workspaceBudgets: 0,
      workspaceMemberships: 0,
    };

    if (conversationIds.length > 0) {
      counts.channelParticipants = (
        await transaction
          .delete(channelParticipants)
          .where(inArray(channelParticipants.conversationId, conversationIds))
          .returning({ id: channelParticipants.id })
      ).length;
    }
    counts.channelConversations = (
      await transaction
        .delete(channelConversations)
        .where(eq(channelConversations.workspaceId, workspaceId))
        .returning({ id: channelConversations.id })
    ).length;
    counts.connectionInstallations = (
      await transaction
        .delete(connectionInstallations)
        .where(eq(connectionInstallations.workspaceId, workspaceId))
        .returning({ id: connectionInstallations.id })
    ).length;
    counts.browserImageArtifacts = (
      await transaction
        .delete(browserImageArtifacts)
        .where(eq(browserImageArtifacts.workspaceId, workspaceId))
        .returning({ id: browserImageArtifacts.id })
    ).length;
    counts.browserSessions = (
      await transaction
        .delete(browserSessions)
        .where(eq(browserSessions.workspaceId, workspaceId))
        .returning({ id: browserSessions.sessionId })
    ).length;
    counts.agentSessions = (
      await transaction
        .delete(agentSessions)
        .where(eq(agentSessions.workspaceId, workspaceId))
        .returning({ sessionId: agentSessions.sessionId })
    ).length;
    counts.chats = (
      await transaction
        .delete(chats)
        .where(eq(chats.workspaceId, workspaceId))
        .returning({ sessionId: chats.sessionId })
    ).length;
    counts.settings = (
      await transaction
        .delete(settings)
        .where(eq(settings.workspaceId, workspaceId))
        .returning({ key: settings.key })
    ).length;
    counts.workspaceBudgets = (
      await transaction
        .delete(workspaceBudgets)
        .where(eq(workspaceBudgets.workspaceId, workspaceId))
        .returning({ workspaceId: workspaceBudgets.workspaceId })
    ).length;
    counts.encryptedSecrets = (
      await transaction
        .delete(encryptedSecrets)
        .where(eq(encryptedSecrets.workspaceId, workspaceId))
        .returning({ id: encryptedSecrets.id })
    ).length;
    counts.vaultItems = (
      await transaction
        .delete(vaultItems)
        .where(eq(vaultItems.workspaceId, workspaceId))
        .returning({ id: vaultItems.id })
    ).length;
    counts.webhookDeliveries = (
      await transaction
        .delete(webhookDeliveries)
        .where(eq(webhookDeliveries.workspaceId, workspaceId))
        .returning({ id: webhookDeliveries.id })
    ).length;
    counts.webhookEvents = (
      await transaction
        .delete(webhookEvents)
        .where(eq(webhookEvents.workspaceId, workspaceId))
        .returning({ id: webhookEvents.id })
    ).length;
    counts.webhookEndpoints = (
      await transaction
        .delete(webhookEndpoints)
        .where(eq(webhookEndpoints.workspaceId, workspaceId))
        .returning({ id: webhookEndpoints.id })
    ).length;

    await transaction
      .update(agents)
      .set({ activeRevisionId: null })
      .where(eq(agents.workspaceId, workspaceId));
    counts.agentRevisions = (
      await transaction
        .delete(agentRevisions)
        .where(eq(agentRevisions.workspaceId, workspaceId))
        .returning({ id: agentRevisions.id })
    ).length;
    counts.agents = (
      await transaction
        .delete(agents)
        .where(eq(agents.workspaceId, workspaceId))
        .returning({ id: agents.id })
    ).length;
    counts.workspaceMemberships = (
      await transaction
        .delete(workspaceMemberships)
        .where(eq(workspaceMemberships.workspaceId, workspaceId))
        .returning({ userId: workspaceMemberships.userId })
    ).length;

    const [updated] = await transaction
      .update(workspaces)
      .set({ lifecycleState: "deleted", updatedAt: now })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.lifecycleState, "pending_deletion")
        )
      )
      .returning({ id: workspaces.id });
    if (!updated) {
      throw new WorkspaceLifecycleTransitionError(
        "pending_deletion",
        "deleted"
      );
    }
    await transaction.insert(auditEvents).values({
      action: "workspace.delete",
      actorUserId: scope.userId,
      createdAt: now,
      id: randomUUID(),
      metadata: {
        deletedCounts: counts,
        externalCleanupPending: ["blob", "kernel", "provider_grants"],
        retained: ["usage_events", "audit_events"],
      },
      outcome: "ok",
      target: workspaceId,
      workspaceId,
    });

    return counts;
  });
}

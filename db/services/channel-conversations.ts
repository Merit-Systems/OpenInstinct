import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { accessScopeForUser } from "@/lib/access-scope";
import {
  agents,
  channelConversations,
  channelParticipants,
  db,
  phoneIdentities,
  platformLines,
} from "@/db";
import { recordAuditEvent } from "./audit";

const bindingSelection = {
  agentId: channelConversations.agentId,
  createdAt: channelConversations.createdAt,
  id: channelConversations.id,
  pinnedRevisionId: channelConversations.pinnedRevisionId,
  platformLine: platformLines,
  platformLineId: channelConversations.platformLineId,
  provider: channelConversations.provider,
  providerAccountId: channelConversations.providerAccountId,
  providerConversationId: channelConversations.providerConversationId,
  status: channelConversations.status,
  updatedAt: channelConversations.updatedAt,
  workspaceId: channelConversations.workspaceId,
};

function activeBindingConditions({
  provider,
  providerAccountId,
  providerConversationId,
  workspaceId,
}: {
  readonly provider: string;
  readonly providerAccountId: string;
  readonly providerConversationId: string;
  readonly workspaceId?: string;
}) {
  return and(
    eq(channelConversations.provider, provider),
    eq(channelConversations.providerAccountId, providerAccountId),
    eq(channelConversations.providerConversationId, providerConversationId),
    eq(channelConversations.status, "active"),
    ...(workspaceId ? [eq(channelConversations.workspaceId, workspaceId)] : [])
  );
}

export async function resolveConversationBinding({
  provider,
  providerAccountId,
  providerConversationId,
}: {
  readonly provider: string;
  readonly providerAccountId: string;
  readonly providerConversationId: string;
}) {
  const [binding] = await db
    .select(bindingSelection)
    .from(channelConversations)
    .innerJoin(
      platformLines,
      eq(platformLines.id, channelConversations.platformLineId)
    )
    .where(
      activeBindingConditions({
        provider,
        providerAccountId,
        providerConversationId,
      })
    )
    .limit(1);
  return binding;
}

export async function createConversationBinding({
  phoneIdentityId,
  platformLine,
  provider,
  providerAccountId,
  providerConversationId,
  userId,
}: {
  readonly phoneIdentityId: string;
  readonly platformLine: {
    readonly connectorId?: string;
    readonly environment?: string;
    readonly providerLineId: string;
  };
  readonly provider: "linq";
  readonly providerAccountId: string;
  readonly providerConversationId: string;
  readonly userId: string;
}) {
  const scope = accessScopeForUser(`better-auth:${userId}`);
  const now = new Date().toISOString();

  const binding = await db.transaction(async (transaction) => {
    const [identity] = await transaction
      .select({ id: phoneIdentities.id })
      .from(phoneIdentities)
      .where(
        and(
          eq(phoneIdentities.id, phoneIdentityId),
          eq(phoneIdentities.userId, userId),
          eq(phoneIdentities.status, "verified")
        )
      )
      .limit(1);
    if (!identity) return;

    const activeAgents = await transaction
      .select({ id: agents.id, activeRevisionId: agents.activeRevisionId })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, scope.workspaceId),
          eq(agents.status, "active"),
          isNotNull(agents.activeRevisionId)
        )
      )
      .for("update")
      .limit(2);
    if (activeAgents.length !== 1) return;
    const [agent] = activeAgents;
    if (!agent?.activeRevisionId) return;

    await transaction
      .insert(platformLines)
      .values({
        connectorId: platformLine.connectorId,
        environment: platformLine.environment,
        id: randomUUID(),
        provider,
        providerLineId: platformLine.providerLineId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          connectorId: platformLine.connectorId,
          environment: platformLine.environment,
          updatedAt: now,
        },
        target: [platformLines.provider, platformLines.providerLineId],
      });
    const [line] = await transaction
      .select({ id: platformLines.id })
      .from(platformLines)
      .where(
        and(
          eq(platformLines.provider, provider),
          eq(platformLines.providerLineId, platformLine.providerLineId)
        )
      )
      .limit(1);
    if (!line) throw new Error("Failed to resolve platform line.");

    await transaction
      .insert(channelConversations)
      .values({
        agentId: agent.id,
        id: randomUUID(),
        pinnedRevisionId: agent.activeRevisionId,
        platformLineId: line.id,
        provider,
        providerAccountId,
        providerConversationId,
        updatedAt: now,
        workspaceId: scope.workspaceId,
      })
      .onConflictDoNothing({
        target: [
          channelConversations.provider,
          channelConversations.providerAccountId,
          channelConversations.providerConversationId,
        ],
      });

    const [binding] = await transaction
      .select(bindingSelection)
      .from(channelConversations)
      .innerJoin(
        platformLines,
        eq(platformLines.id, channelConversations.platformLineId)
      )
      .where(
        activeBindingConditions({
          provider,
          providerAccountId,
          providerConversationId,
          workspaceId: scope.workspaceId,
        })
      )
      .limit(1);
    if (!binding) return;

    await transaction
      .insert(channelParticipants)
      .values({
        conversationId: binding.id,
        id: randomUUID(),
        phoneIdentityId,
      })
      .onConflictDoNothing({
        target: [
          channelParticipants.conversationId,
          channelParticipants.phoneIdentityId,
        ],
      });
    return binding;
  });
  if (binding) {
    void recordAuditEvent(scope, {
      action: "channel.conversation.bind",
      target: binding.id,
    }).catch(() => {
      console.warn("[audit] event recording failed");
    });
  }
  return binding;
}

// Lifecycle close handling arrives with the channel webhook slice.

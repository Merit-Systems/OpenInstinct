import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import {
  agentManifestContentDigest,
  agentManifestSchema,
  canonicalAgentManifest,
} from "@/lib/agent-manifest";
import { agentRevisions, agents, db } from "@/db";
import { recordAuditEvent } from "./audit";
import { emitWebhookEvent } from "./webhooks";

export async function createAgent(
  scope: AccessScope,
  input: z.input<typeof agentInputSchema>
) {
  const parsedInput = agentInputSchema.parse(input);
  const now = new Date().toISOString();
  const [agent] = await db
    .insert(agents)
    .values({
      createdAt: now,
      displayName: parsedInput.displayName,
      id: randomUUID(),
      slug: parsedInput.slug,
      workspaceId: scope.workspaceId,
    })
    .returning();
  if (!agent) throw new Error("Failed to create agent.");
  return agent;
}

export async function createRevision(
  scope: AccessScope,
  agentId: string,
  manifest: z.input<typeof agentManifestSchema>
) {
  const parsedManifest = agentManifestSchema.parse(manifest);
  const canonicalManifest = canonicalAgentManifest(parsedManifest);
  const now = new Date().toISOString();
  return await db.transaction(async (transaction) => {
    const [agent] = await transaction
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(eq(agents.id, agentId), eq(agents.workspaceId, scope.workspaceId))
      )
      .for("update")
      .limit(1);
    if (!agent) throw new Error("Agent not found.");

    const [latest] = await transaction
      .select({ revisionNumber: agentRevisions.revisionNumber })
      .from(agentRevisions)
      .where(
        and(
          eq(agentRevisions.agentId, agentId),
          eq(agentRevisions.workspaceId, scope.workspaceId)
        )
      )
      .orderBy(desc(agentRevisions.revisionNumber))
      .limit(1);
    const [revision] = await transaction
      .insert(agentRevisions)
      .values({
        agentId,
        contentDigest: agentManifestContentDigest(canonicalManifest),
        createdAt: now,
        id: randomUUID(),
        manifest: canonicalManifest,
        createdByUserId: scope.userId,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        workspaceId: scope.workspaceId,
      })
      .returning();
    if (!revision) throw new Error("Failed to create agent revision.");
    return revision;
  });
}

export async function publishRevision(
  scope: AccessScope,
  agentId: string,
  revisionId: string
) {
  const agent = await moveActiveRevision(
    scope,
    agentId,
    revisionId,
    "agent.published"
  );
  recordAudit(scope, "agent.publish", agentId);
  return agent;
}

export async function rollback(
  scope: AccessScope,
  agentId: string,
  revisionId: string
) {
  const agent = await moveActiveRevision(
    scope,
    agentId,
    revisionId,
    "agent.rolled_back"
  );
  recordAudit(scope, "agent.rollback", agentId);
  return agent;
}

function recordAudit(scope: AccessScope, action: string, target: string) {
  void recordAuditEvent(scope, { action, target }).catch(() => {
    console.warn("[audit] event recording failed");
  });
}

export async function listAgents(scope: AccessScope) {
  return await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, scope.workspaceId))
    .orderBy(agents.createdAt);
}

export async function getAgent(scope: AccessScope, agentId: string) {
  const [row] = await db
    .select({ agent: agents, activeRevision: agentRevisions })
    .from(agents)
    .leftJoin(
      agentRevisions,
      and(
        eq(agentRevisions.id, agents.activeRevisionId),
        eq(agentRevisions.workspaceId, agents.workspaceId)
      )
    )
    .where(
      and(eq(agents.id, agentId), eq(agents.workspaceId, scope.workspaceId))
    )
    .limit(1);
  if (!row) return;
  return { ...row.agent, activeRevision: row.activeRevision };
}

export async function listRevisions(scope: AccessScope, agentId: string) {
  return await db
    .select()
    .from(agentRevisions)
    .where(
      and(
        eq(agentRevisions.agentId, agentId),
        eq(agentRevisions.workspaceId, scope.workspaceId)
      )
    )
    .orderBy(agentRevisions.revisionNumber);
}

export async function archiveAgent(scope: AccessScope, agentId: string) {
  const [agent] = await db
    .update(agents)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(
      and(eq(agents.id, agentId), eq(agents.workspaceId, scope.workspaceId))
    )
    .returning();
  return agent;
}

async function moveActiveRevision(
  scope: AccessScope,
  agentId: string,
  revisionId: string,
  webhookEventType: "agent.published" | "agent.rolled_back"
) {
  return await db.transaction(async (transaction) => {
    const [agent] = await transaction
      .select({ status: agents.status })
      .from(agents)
      .where(
        and(eq(agents.id, agentId), eq(agents.workspaceId, scope.workspaceId))
      )
      .for("update")
      .limit(1);
    if (!agent) throw new Error("Agent not found.");
    if (agent.status === "archived") throw new Error("Agent is archived.");

    const [revision] = await transaction
      .select({ id: agentRevisions.id })
      .from(agentRevisions)
      .where(
        and(
          eq(agentRevisions.id, revisionId),
          eq(agentRevisions.agentId, agentId),
          eq(agentRevisions.workspaceId, scope.workspaceId)
        )
      )
      .limit(1);
    if (!revision) throw new Error("Revision does not belong to this agent.");

    const [updatedAgent] = await transaction
      .update(agents)
      .set({
        activeRevisionId: revision.id,
        status: "active",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(agents.id, agentId), eq(agents.workspaceId, scope.workspaceId))
      )
      .returning();
    if (!updatedAgent) throw new Error("Failed to move active revision.");
    await emitWebhookEvent(transaction, scope, {
      payload: { agentId, revisionId },
      type: webhookEventType,
    });
    return updatedAgent;
  });
}

const agentInputSchema = agentManifestSchema
  .pick({ displayName: true })
  .extend({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) });

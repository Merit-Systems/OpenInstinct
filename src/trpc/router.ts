import { gateway } from "ai";
import { revokeToken, startAuthorization } from "@vercel/connect";
import { z } from "zod";
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { adminTransitionWorkspaceLifecycle } from "@/db/services/workspace-lifecycle";
import { recordAuditEvent } from "@/db/services/audit";
import { ensureScope } from "@/db/services/scope";
import {
  drainWebhookDeliveries,
  webhookEventTypes,
} from "@/db/services/webhooks";
import {
  agents,
  apiCredentials,
  auditEvents,
  channelConversations,
  chats,
  db,
  phoneIdentities,
  usageEvents,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  workspaceLifecycleStates,
  workspaceMemberships,
  workspaces,
} from "@/db";
import { listBrowserTraces } from "@/db/services/browser-traces";
import { saveChat } from "@/db/services/chats";
import { selectGatewayModel } from "@/db/services/settings";
import { deleteVaultItem, saveVaultItem } from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { saveChatSchema } from "@/lib/chat";
import { env } from "@/env";
import {
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@/lib/google-workspace";
import {
  listApiCredentials,
  mintApiCredential,
  revokeApiCredential,
} from "@/db/services/api-credentials";
import {
  deleteRevokedConnectionInstallation,
  revokeConnectionInstallation,
} from "@/db/services/connection-installations";
import {
  disableWebhookEndpoint,
  listWebhookEndpoints,
  registerWebhookEndpoint,
  rotateWebhookSecret,
} from "@/db/services/webhooks";
import { isWorkspaceScopeEnforcementEnabled } from "@/env";
import { googleWorkspaceScopes } from "@/lib/google-workspace";
import { vaultCreateItemSchema, vaultImportItemsSchema } from "@/lib/vault";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "./init";

const auditCursorSchema = z.object({ createdAt: z.string(), id: z.string() });
const auditCursor = z.string().transform((value, context) => {
  try {
    return auditCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString())
    );
  } catch {
    context.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
});

function encodeAuditCursor(row: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify(row)).toString("base64url");
}

function startOfCurrentUtcMonth() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
}

function groupedCounts(rows: readonly { key: string; count: number }[]) {
  return Object.fromEntries(rows.map((row) => [row.key, row.count]));
}

export const appRouter = createTRPCRouter({
  admin: {
    overview: adminProcedure.query(async () => {
      const since = startOfCurrentUtcMonth();
      const [
        workspaceRows,
        agentRows,
        phoneRows,
        conversationRows,
        credentialRows,
        endpointRows,
        usageRows,
        deliveryRows,
        recentAudit,
      ] = await Promise.all([
        db
          .select({
            key: workspaces.lifecycleState,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(workspaces)
          .groupBy(workspaces.lifecycleState),
        db
          .select({
            key: agents.status,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(agents)
          .groupBy(agents.status),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(phoneIdentities)
          .where(eq(phoneIdentities.status, "verified")),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(channelConversations)
          .where(eq(channelConversations.status, "active")),
        db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(apiCredentials)
          .where(eq(apiCredentials.status, "active")),
        db
          .select({
            key: webhookEndpoints.status,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(webhookEndpoints)
          .groupBy(webhookEndpoints.status),
        db
          .select({
            key: usageEvents.kind,
            quantity:
              sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`.mapWith(
                Number
              ),
          })
          .from(usageEvents)
          .where(gte(usageEvents.createdAt, since))
          .groupBy(usageEvents.kind),
        db
          .select({
            key: webhookDeliveries.outcome,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(webhookDeliveries)
          .groupBy(webhookDeliveries.outcome),
        db
          .select({
            id: auditEvents.id,
            workspaceId: auditEvents.workspaceId,
            actorUserId: auditEvents.actorUserId,
            action: auditEvents.action,
            target: auditEvents.target,
            outcome: auditEvents.outcome,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(10),
      ]);
      return {
        workspacesByLifecycle: groupedCounts(workspaceRows),
        agentsByStatus: groupedCounts(agentRows),
        verifiedPhoneIdentities: phoneRows[0]?.count ?? 0,
        activeChannelConversations: conversationRows[0]?.count ?? 0,
        activeApiCredentials: credentialRows[0]?.count ?? 0,
        webhookEndpointsByStatus: groupedCounts(endpointRows),
        usageByKind: Object.fromEntries(
          usageRows.map((row) => [row.key, row.quantity])
        ),
        webhookDeliveryOutcomes: groupedCounts(deliveryRows),
        recentAudit,
      };
    }),
    usage: adminProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1).optional(),
          sinceIso: z.iso.datetime().optional(),
        })
      )
      .query(async ({ input }) => {
        const predicates = [
          input.workspaceId
            ? eq(usageEvents.workspaceId, input.workspaceId)
            : undefined,
          input.sinceIso
            ? gte(usageEvents.createdAt, input.sinceIso)
            : undefined,
        ].filter(
          (value): value is NonNullable<typeof value> => value !== undefined
        );
        const where = predicates.length === 0 ? undefined : and(...predicates);
        const rows = await db
          .select({
            workspaceId: usageEvents.workspaceId,
            kind: usageEvents.kind,
            quantity:
              sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`.mapWith(
                Number
              ),
          })
          .from(usageEvents)
          .where(where)
          .groupBy(usageEvents.workspaceId, usageEvents.kind)
          .orderBy(desc(sql`coalesce(sum(${usageEvents.quantity}), 0)`))
          .limit(50);
        return rows;
      }),
    auditLog: adminProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1).optional(),
          cursor: auditCursor.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
      )
      .query(async ({ input }) => {
        const cursorWhere =
          input.cursor &&
          or(
            lt(auditEvents.createdAt, input.cursor.createdAt),
            and(
              eq(auditEvents.createdAt, input.cursor.createdAt),
              lt(auditEvents.id, input.cursor.id)
            )
          );
        const where = [
          input.workspaceId
            ? eq(auditEvents.workspaceId, input.workspaceId)
            : undefined,
          cursorWhere,
        ].filter(
          (value): value is NonNullable<typeof value> => value !== undefined
        );
        const rows = await db
          .select({
            id: auditEvents.id,
            workspaceId: auditEvents.workspaceId,
            actorUserId: auditEvents.actorUserId,
            action: auditEvents.action,
            target: auditEvents.target,
            outcome: auditEvents.outcome,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .where(where.length ? and(...where) : undefined)
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(input.limit + 1);
        const hasMore = rows.length > input.limit;
        const events = rows.slice(0, input.limit);
        const last = events.at(-1);
        return {
          events,
          nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
        };
      }),
    webhookDeliveries: adminProcedure
      .input(
        z.object({
          outcome: z
            .enum(["pending", "delivered", "failed", "dead"])
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
      )
      .query(async ({ input }) => {
        return db
          .select({
            id: webhookDeliveries.id,
            workspaceId: webhookDeliveries.workspaceId,
            endpointUrl: webhookEndpoints.url,
            eventType: webhookEvents.type,
            attempt: webhookDeliveries.attempt,
            responseStatus: webhookDeliveries.responseStatus,
            outcome: webhookDeliveries.outcome,
            createdAt: webhookDeliveries.createdAt,
            updatedAt: webhookDeliveries.updatedAt,
          })
          .from(webhookDeliveries)
          .innerJoin(
            webhookEndpoints,
            eq(webhookDeliveries.endpointId, webhookEndpoints.id)
          )
          .innerJoin(
            webhookEvents,
            eq(webhookDeliveries.eventId, webhookEvents.id)
          )
          .where(
            input.outcome
              ? eq(webhookDeliveries.outcome, input.outcome)
              : undefined
          )
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(input.limit);
      }),
    workspaces: adminProcedure
      .input(
        z.object({
          cursor: auditCursor.optional(),
          limit: z.number().int().min(1).max(50).default(50),
        })
      )
      .query(async ({ input }) => {
        const since = startOfCurrentUtcMonth();
        const cursorWhere =
          input.cursor &&
          or(
            lt(workspaces.createdAt, input.cursor.createdAt),
            and(
              eq(workspaces.createdAt, input.cursor.createdAt),
              lt(workspaces.id, input.cursor.id)
            )
          );
        const rows = await db
          .select({
            id: workspaces.id,
            displayName: workspaces.displayName,
            plan: workspaces.plan,
            lifecycleState: workspaces.lifecycleState,
            createdAt: workspaces.createdAt,
            memberCount:
              sql<number>`(select count(*) from ${workspaceMemberships} where ${workspaceMemberships.workspaceId} = ${workspaces.id})`.mapWith(
                Number
              ),
            agentCount:
              sql<number>`(select count(*) from ${agents} where ${agents.workspaceId} = ${workspaces.id})`.mapWith(
                Number
              ),
            modelTokens:
              sql<number>`(select coalesce(sum(${usageEvents.quantity}), 0) from ${usageEvents} where ${usageEvents.workspaceId} = ${workspaces.id} and ${usageEvents.kind} = 'model_tokens' and ${usageEvents.createdAt} >= ${since})`.mapWith(
                Number
              ),
          })
          .from(workspaces)
          .where(cursorWhere)
          .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
          .limit(input.limit + 1);
        const hasMore = rows.length > input.limit;
        const items = rows
          .slice(0, input.limit)
          .map(({ createdAt: _createdAt, ...row }) => row);
        const last = rows.slice(0, input.limit).at(-1);
        return {
          workspaces: items,
          items,
          nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
        };
      }),
    sessionsActivity: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).default(50) }))
      .query(({ input }) =>
        db
          .select({
            id: chats.sessionId,
            workspaceId: chats.workspaceId,
            updatedAt: chats.updatedAt,
            inputTokens: chats.inputTokens,
            outputTokens: chats.outputTokens,
            costUsd: chats.costUsd,
          })
          .from(chats)
          .orderBy(desc(chats.updatedAt))
          .limit(input.limit)
      ),
    drainWebhooks: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).default(50) }))
      .mutation(async ({ ctx, input }) => {
        await ensureScope(ctx.scope);
        const summary = await drainWebhookDeliveries({ limit: input.limit });
        await recordAuditEvent(ctx.scope, {
          action: "admin.webhook_drain",
          metadata: { ...summary, limit: input.limit },
        });
        return summary;
      }),
    transitionLifecycle: adminProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          to: z.enum(workspaceLifecycleStates),
        })
      )
      .mutation(({ ctx, input }) =>
        adminTransitionWorkspaceLifecycle(
          ctx.scope.userId,
          input.workspaceId,
          input.to
        )
      ),
  },
  apiCredentials: {
    list: protectedProcedure.query(({ ctx }) => listApiCredentials(ctx.scope)),
    mint: protectedProcedure
      .input(
        z.object({
          name: z.string(),
          scopes: z
            .array(z.enum(["agents:read", "agents:write", "usage:read"]))
            .min(1),
          expiresAt: z.iso.datetime().optional(),
        })
      )
      .mutation(({ ctx, input }) => mintApiCredential(ctx.scope, input)),
    revoke: protectedProcedure
      .input(z.object({ credentialId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        revokeApiCredential(ctx.scope, input.credentialId)
      ),
  },
  webhookEndpoints: {
    list: protectedProcedure.query(({ ctx }) =>
      listWebhookEndpoints(ctx.scope)
    ),
    register: protectedProcedure
      .input(
        z.object({
          url: z.string(),
          subscribedEvents: z.array(z.enum(webhookEventTypes)).min(1),
        })
      )
      .mutation(({ ctx, input }) => registerWebhookEndpoint(ctx.scope, input)),
    disable: protectedProcedure
      .input(z.object({ endpointId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        disableWebhookEndpoint(ctx.scope, input.endpointId)
      ),
    rotate: protectedProcedure
      .input(z.object({ endpointId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        rotateWebhookSecret(ctx.scope, input.endpointId)
      ),
  },
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(z.enum(["connect", "disconnect"]))
      .mutation(async ({ ctx, input }) => {
        if (input === "disconnect") {
          await revokeToken(env.GOOGLE_CONNECTOR_UID, {
            subject: googleWorkspaceSubject(ctx.scope.userId),
          });
          if (isWorkspaceScopeEnforcementEnabled()) {
            try {
              await revokeConnectionInstallation(
                ctx.scope,
                googleWorkspaceInstallation(ctx.scope)
              );
            } catch {
              console.warn(
                "[google-workspace] connection installation revocation failed"
              );
            }
          }
          return { redirectTo: "/?google=disconnected" };
        }

        const callbackUrl = new URL("/", ctx.origin);
        callbackUrl.searchParams.set("google", "connected");
        if (isWorkspaceScopeEnforcementEnabled()) {
          await deleteRevokedConnectionInstallation(
            ctx.scope,
            googleWorkspaceInstallation(ctx.scope)
          );
        }
        return {
          redirectTo: await startGoogleWorkspaceAuthorization(
            ctx.scope,
            callbackUrl.toString()
          ),
        };
      }),
  },
  settings: {
    selectModel: protectedProcedure
      .input(z.object({ modelId: z.string().trim().min(1).max(300) }))
      .mutation(({ ctx, input }) =>
        selectGatewayModel(ctx.scope, input.modelId)
      ),
  },
  traces: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        listBrowserTraces(ctx.scope, input.cursor ?? undefined)
      ),
  },
  vault: {
    create: protectedProcedure
      .input(vaultCreateItemSchema)
      .mutation(({ ctx, input }) => saveVaultItem(ctx.scope, input)),
    import: protectedProcedure
      .input(vaultImportItemsSchema)
      .mutation(async ({ ctx, input }) => {
        /* oxlint-disable eslint/no-await-in-loop -- Import preserves source order and avoids concurrent writes to the same vault scope. */
        for (const item of input) await saveVaultItem(ctx.scope, item);
        /* oxlint-enable eslint/no-await-in-loop */
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => deleteVaultItem(ctx.scope, input.id)),
  },
  models: {
    list: protectedProcedure.query(readModelCatalog),
  },
});

export type AppRouter = typeof appRouter;

async function startGoogleWorkspaceAuthorization(
  scope: AccessScope,
  callbackUrl: string
) {
  const authorization = await startAuthorization(
    env.GOOGLE_CONNECTOR_UID,
    googleWorkspaceTokenParams(scope.userId),
    { callbackUrl, expiresInMs: 10 * 60_000 }
  );
  return authorization.url;
}

async function readModelCatalog() {
  const { models } = await gateway.getAvailableModels();

  return z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownedBy: z.string(),
        pricing: z
          .object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
          })
          .optional(),
      })
    )
    .parse(
      models
        .filter((model) => model.modelType === "language")
        .map((model) => ({
          id: model.id,
          name: model.name,
          ownedBy: model.specification.provider,
          pricing: model.pricing
            ? {
                input: perMillion(model.pricing.input),
                output: perMillion(model.pricing.output),
              }
            : undefined,
        }))
    );
}

function perMillion(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

function googleWorkspaceInstallation(scope: AccessScope) {
  return {
    authorizationSubject: JSON.stringify(googleWorkspaceSubject(scope.userId)),
    connectorId: env.GOOGLE_CONNECTOR_UID,
    provider: "google" as const,
    scopes: googleWorkspaceScopes,
  };
}

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { env } from "@/lib/env";
import {
  db,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  workspaceMemberships,
} from "@/db";
import { recordAuditEvent } from "./audit";
import { ensureScope } from "./scope";

const maxAttempts = 6;
export const webhookEventTypes = [
  "agent.published",
  "agent.rolled_back",
  "workspace.suspended",
  "workspace.reactivated",
  "workspace.deletion_started",
] as const;
type WebhookEventType = (typeof webhookEventTypes)[number];
const endpointInputSchema = z.object({
  subscribedEvents: z.array(z.enum(webhookEventTypes)).min(1).max(100),
  url: z.string().trim().min(1).max(2048),
});
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
class WebhookUrlRejectedError extends Error {}

export async function registerWebhookEndpoint(
  scope: AccessScope,
  input: unknown
) {
  const parsed = endpointInputSchema.parse(input);
  const url = requirePublicHttpsUrl(parsed.url);
  await ensureScope(scope);
  const id = randomUUID();
  const secret = webhookSecret();
  const now = new Date().toISOString();
  const endpoint = await db.transaction(async (transaction) => {
    await requireOwner(transaction, scope);
    const [row] = await transaction
      .insert(webhookEndpoints)
      .values({
        encryptedSigningSecret: encryptWebhookSecret(id, secret),
        id,
        subscribedEvents: [...new Set(parsed.subscribedEvents)],
        url,
        workspaceId: scope.workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to register webhook endpoint.");
    return withoutSecret(row);
  });
  recordAudit(scope, {
    action: "webhook_endpoint.register",
    target: id,
  });
  return { endpoint, secret };
}

export async function listWebhookEndpoints(scope: AccessScope) {
  await ensureScope(scope);
  return db.transaction(async (transaction) => {
    const owner = await isOwner(transaction, scope);
    if (!owner) return [];
    return (
      await transaction
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.workspaceId, scope.workspaceId))
    ).map(withoutSecret);
  });
}

export async function disableWebhookEndpoint(
  scope: AccessScope,
  endpointId: string
) {
  await ensureScope(scope);
  const now = new Date().toISOString();
  const disabled = await db.transaction(async (transaction) => {
    await requireOwner(transaction, scope);
    const rows = await transaction
      .update(webhookEndpoints)
      .set({
        disabledAt: now,
        status: "disabled",
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.workspaceId, scope.workspaceId),
          eq(webhookEndpoints.status, "active")
        )
      )
      .returning({ id: webhookEndpoints.id });
    if (rows.length === 0) return false;
    await transaction
      .update(webhookDeliveries)
      .set({ outcome: "dead", updatedAt: now })
      .where(
        and(
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.workspaceId, scope.workspaceId),
          inArray(webhookDeliveries.outcome, ["pending", "failed"])
        )
      );
    return true;
  });
  if (disabled)
    recordAudit(scope, {
      action: "webhook_endpoint.disable",
      target: endpointId,
    });
  return disabled;
}

export async function rotateWebhookSecret(
  scope: AccessScope,
  endpointId: string
) {
  await ensureScope(scope);
  const secret = webhookSecret();
  const now = new Date().toISOString();
  const endpoint = await db.transaction(async (transaction) => {
    await requireOwner(transaction, scope);
    const [row] = await transaction
      .update(webhookEndpoints)
      .set({
        encryptedSigningSecret: encryptWebhookSecret(endpointId, secret),
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookEndpoints.id, endpointId),
          eq(webhookEndpoints.workspaceId, scope.workspaceId),
          eq(webhookEndpoints.status, "active")
        )
      )
      .returning();
    return row ? withoutSecret(row) : undefined;
  });
  if (endpoint)
    recordAudit(scope, {
      action: "webhook_endpoint.rotate_secret",
      target: endpointId,
    });
  return endpoint ? { endpoint, secret } : undefined;
}

export async function emitWebhookEvent(
  executor: Executor,
  scope: AccessScope,
  input: {
    readonly type: WebhookEventType;
    readonly payload: Record<string, string>;
    readonly correlationId?: string;
  }
) {
  assertSafePayload(input.payload);
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const [event] = await executor
    .insert(webhookEvents)
    .values({
      correlationId: input.correlationId,
      createdAt: now,
      id: eventId,
      payload: input.payload,
      type: input.type,
      workspaceId: scope.workspaceId,
    })
    .returning();
  if (!event) throw new Error("Failed to record webhook event.");
  return event;
}

export async function drainWebhookDeliveries({
  limit = 50,
  fetchImpl = globalThis.fetch,
}: { readonly limit?: number; readonly fetchImpl?: typeof fetch } = {}) {
  const now = new Date().toISOString();
  await db
    .update(webhookDeliveries)
    .set({ outcome: "dead", updatedAt: now })
    .where(
      and(
        inArray(webhookDeliveries.outcome, ["pending", "failed"]),
        gte(webhookDeliveries.attempt, maxAttempts)
      )
    );
  await fanOutWebhookEvents();
  const summary = { dead: 0, delivered: 0, failed: 0 };
  for (let index = 0; index < Math.max(1, Math.min(limit, 500)); index += 1) {
    const result = await db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          delivery: webhookDeliveries,
          endpoint: webhookEndpoints,
          event: webhookEvents,
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
          and(
            eq(webhookEndpoints.status, "active"),
            lte(webhookDeliveries.nextAttemptAt, new Date().toISOString()),
            inArray(webhookDeliveries.outcome, ["pending", "failed"]),
            lte(webhookDeliveries.attempt, maxAttempts - 1)
          )
        )
        .for("update", { skipLocked: true })
        .limit(1);
      if (!row) return;
      return await deliver(
        transaction,
        row.delivery,
        row.endpoint,
        row.event,
        fetchImpl
      );
    });
    if (!result) break;
    summary[result] += 1;
  }
  return summary;
}

async function fanOutWebhookEvents() {
  const now = new Date().toISOString();
  await db.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(webhookEvents)
      .where(isNull(webhookEvents.fannedOutAt))
      .for("update", { skipLocked: true });
    for (const event of events) {
      const endpoints = (
        await transaction
          .select()
          .from(webhookEndpoints)
          .where(
            and(
              eq(webhookEndpoints.workspaceId, event.workspaceId),
              eq(webhookEndpoints.status, "active")
            )
          )
      ).filter((endpoint) =>
        subscribedTo(endpoint.subscribedEvents, event.type)
      );
      if (endpoints.length > 0) {
        await transaction.insert(webhookDeliveries).values(
          endpoints.map((endpoint) => ({
            createdAt: now,
            endpointId: endpoint.id,
            eventId: event.id,
            id: randomUUID(),
            nextAttemptAt: now,
            updatedAt: now,
            workspaceId: event.workspaceId,
          }))
        );
      }
      await transaction
        .update(webhookEvents)
        .set({ fannedOutAt: now })
        .where(eq(webhookEvents.id, event.id));
    }
  });
}

async function deliver(
  executor: Executor,
  delivery: typeof webhookDeliveries.$inferSelect,
  endpoint: typeof webhookEndpoints.$inferSelect,
  event: typeof webhookEvents.$inferSelect,
  fetchImpl: typeof fetch
): Promise<"dead" | "delivered" | "failed"> {
  const now = new Date().toISOString();
  let responseStatus: number | null = null;
  let outcome: "dead" | "delivered" | "failed";
  try {
    let url: string;
    try {
      url = requirePublicHttpsUrl(endpoint.url);
    } catch {
      throw new WebhookUrlRejectedError(
        "Webhook URL rejected at delivery time."
      );
    }
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      workspaceId: event.workspaceId,
      createdAt: event.createdAt,
      correlationId: event.correlationId,
      data: event.payload,
    });
    const timestamp = now;
    const signature = createHmac(
      "sha256",
      decryptWebhookSecret(endpoint.id, endpoint.encryptedSigningSecret)
    )
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex");
    const response = await fetchWithTimeout(fetchImpl, url, {
      body,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-oi-event-id": event.id,
        "x-oi-timestamp": timestamp,
        "x-oi-signature": `v1=${signature}`,
      },
    });
    responseStatus = response.status;
    await response.body?.cancel();
    outcome =
      response.status >= 200 && response.status < 300
        ? "delivered"
        : response.status === 429 || response.status >= 500
          ? "failed"
          : "dead";
  } catch (error) {
    outcome = error instanceof WebhookUrlRejectedError ? "dead" : "failed";
  }
  const attempt = delivery.attempt + 1;
  if (outcome === "failed" && attempt >= maxAttempts) outcome = "dead";
  const nextAttemptAt =
    outcome === "failed"
      ? new Date(Date.now() + 2 ** delivery.attempt * 60_000).toISOString()
      : now;
  await executor
    .update(webhookDeliveries)
    .set({ attempt, outcome, responseStatus, nextAttemptAt, updatedAt: now })
    .where(
      and(
        eq(webhookDeliveries.id, delivery.id),
        eq(webhookDeliveries.workspaceId, delivery.workspaceId)
      )
    );
  return outcome;
}

function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);
  return fetchImpl(url, {
    ...init,
    redirect: "manual",
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });
}

function subscribedTo(value: unknown, type: string) {
  return Array.isArray(value) && value.some((event) => event === type);
}

function assertSafePayload(payload: Record<string, string>) {
  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value !== "string" ||
      /secret|phone|password|token|credential/i.test(key)
    )
      throw new Error(
        "Webhook payloads may only contain identifier and type fields."
      );
  }
}

function withoutSecret({
  encryptedSigningSecret: _secret,
  ...endpoint
}: typeof webhookEndpoints.$inferSelect) {
  return endpoint;
}

function recordAudit(
  scope: AccessScope,
  event: Parameters<typeof recordAuditEvent>[1]
) {
  void recordAuditEvent(scope, event).catch(() => {
    console.warn("[audit] event recording failed");
  });
}

async function requireOwner(executor: Executor, scope: AccessScope) {
  if (!(await isOwner(executor, scope)))
    throw new Error("Only workspace owners can manage webhook endpoints.");
}
async function isOwner(executor: Executor, scope: AccessScope) {
  const [membership] = await executor
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
  return membership?.role === "owner" && membership.status === "active";
}

function webhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}
function derivedKey() {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(env.SECRET_ENCRYPTION_KEY, "base64"),
      Buffer.alloc(0),
      "webhook-endpoint-aead",
      32
    )
  );
}
function aad(id: string) {
  return Buffer.from(`webhook-endpoint\u0000${id}`);
}
function encryptWebhookSecret(id: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  cipher.setAAD(aad(id));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
export function encryptWebhookSecretForTest(id: string, secret: string) {
  return encryptWebhookSecret(id, secret);
}
export function decryptWebhookSecretForTest(id: string, value: string) {
  return decryptWebhookSecret(id, value);
}
function decryptWebhookSecret(id: string, value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("The stored webhook secret uses an unsupported format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAAD(aad(id));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function requirePublicHttpsUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Webhook URL must be a valid public HTTPS URL.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol !== "https:" || !host || isPrivateHost(host))
    throw new Error("Webhook URL must be a public HTTPS URL.");
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}
function isPrivateHost(host: string) {
  // IPv6 is conservatively rejected. This hostname-only guard does not resolve DNS.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata" ||
    host.includes("metadata.google.internal") ||
    host.includes(":")
  )
    return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part)))
    return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return true;
  const a = octets[0];
  const b = octets[1];
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

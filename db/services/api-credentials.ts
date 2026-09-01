import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import {
  apiCredentialScopes,
  apiCredentials,
  db,
  workspaceMemberships,
} from "@/db";
import { recordAuditEvent } from "./audit";
import { ensureScope } from "./scope";

const mintInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(apiCredentialScopes)).min(1),
  expiresAt: z.iso.datetime().optional(),
});

type Credential = Omit<typeof apiCredentials.$inferSelect, "keyHash">;

function withoutHash({
  keyHash: _keyHash,
  ...credential
}: typeof apiCredentials.$inferSelect): Credential {
  return credential;
}

export async function mintApiCredential(
  scope: AccessScope,
  input: z.input<typeof mintInputSchema>
) {
  const parsed = mintInputSchema.parse(input);
  await ensureScope(scope);
  const secret = `oi_${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const credential = await db.transaction(async (transaction) => {
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
      throw new Error("Only workspace owners can manage API credentials.");
    }
    const [row] = await transaction
      .insert(apiCredentials)
      .values({
        id: randomUUID(),
        workspaceId: scope.workspaceId,
        name: parsed.name,
        keyHash: hashApiKey(secret),
        keyPrefix: secret.slice(0, 11),
        scopes: [...new Set(parsed.scopes)],
        createdByUserId: scope.userId,
        expiresAt: parsed.expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to mint API credential.");
    return withoutHash(row);
  });
  await recordAuditEvent(scope, {
    action: "api_credential.mint",
    target: credential.id,
  });
  return { credential, secret };
}

export async function authenticateApiKey(rawKey: string) {
  const now = new Date().toISOString();
  const [credential] = await db
    .select()
    .from(apiCredentials)
    .where(
      and(
        eq(apiCredentials.keyHash, hashApiKey(rawKey)),
        eq(apiCredentials.status, "active"),
        or(isNull(apiCredentials.expiresAt), gt(apiCredentials.expiresAt, now))
      )
    )
    .limit(1);
  if (!credential) return;
  void db
    .update(apiCredentials)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(apiCredentials.id, credential.id))
    .catch(() => {
      console.warn("[api-credentials] last-used update failed");
    });
  return {
    workspaceId: credential.workspaceId,
    scopes: credential.scopes,
    credentialId: credential.id,
    createdByUserId: credential.createdByUserId,
  };
}

export async function revokeApiCredential(
  scope: AccessScope,
  credentialId: string
) {
  await ensureScope(scope);
  const now = new Date().toISOString();
  const revoked = await db.transaction(async (transaction) => {
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
    if (membership?.role !== "owner" || membership.status !== "active")
      throw new Error("Only workspace owners can manage API credentials.");
    const rows = await transaction
      .update(apiCredentials)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(apiCredentials.id, credentialId),
          eq(apiCredentials.workspaceId, scope.workspaceId),
          eq(apiCredentials.status, "active")
        )
      )
      .returning({ id: apiCredentials.id });
    return rows.length > 0;
  });
  if (revoked)
    await recordAuditEvent(scope, {
      action: "api_credential.revoke",
      target: credentialId,
    });
  return revoked;
}

export async function listApiCredentials(scope: AccessScope) {
  await ensureScope(scope);
  return await db.transaction(async (transaction) => {
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
    if (membership?.role !== "owner" || membership.status !== "active")
      return [];
    const rows = await transaction
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.workspaceId, scope.workspaceId));
    return rows.map(withoutHash);
  });
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

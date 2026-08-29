import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import {
  connectionInstallations,
  db,
  type ConnectionInstallationProvider,
} from "@/db";
import { ensureScope } from "./scope";
import { recordAuditEvent } from "./audit";

interface ConnectionInstallationKey {
  readonly authorizationSubject: string;
  readonly connectorId: string;
  readonly provider: ConnectionInstallationProvider;
}

function installationConditions(
  scope: AccessScope,
  key: ConnectionInstallationKey
) {
  return and(
    eq(connectionInstallations.workspaceId, scope.workspaceId),
    eq(connectionInstallations.provider, key.provider),
    eq(connectionInstallations.connectorId, key.connectorId),
    eq(connectionInstallations.authorizationSubject, key.authorizationSubject)
  );
}

export async function recordConnectionInstallation(
  scope: AccessScope,
  input: ConnectionInstallationKey & { readonly scopes?: readonly string[] }
) {
  await ensureScope(scope);
  const now = new Date().toISOString();
  const [installation] = await db
    .insert(connectionInstallations)
    .values({
      ...input,
      id: randomUUID(),
      scopes: input.scopes ? [...input.scopes] : undefined,
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      set: {
        ...(input.scopes ? { scopes: [...input.scopes] } : {}),
        updatedAt: now,
      },
      target: [
        connectionInstallations.workspaceId,
        connectionInstallations.provider,
        connectionInstallations.connectorId,
        connectionInstallations.authorizationSubject,
      ],
    })
    .returning();
  if (!installation)
    throw new Error("Failed to record connection installation.");
  return installation;
}

export async function findConnectionInstallation(
  scope: AccessScope,
  key: ConnectionInstallationKey
) {
  const [installation] = await db
    .select()
    .from(connectionInstallations)
    .where(installationConditions(scope, key))
    .limit(1);
  return installation;
}

export async function revokeConnectionInstallation(
  scope: AccessScope,
  key: ConnectionInstallationKey
) {
  const now = new Date().toISOString();
  const rows = await db
    .update(connectionInstallations)
    .set({ revokedAt: now, status: "revoked", updatedAt: now })
    .where(installationConditions(scope, key))
    .returning({ id: connectionInstallations.id });
  const revoked = rows.length > 0;
  if (revoked) {
    void recordAuditEvent(scope, {
      action: "connection.installation.revoke",
      target: `${key.provider}:${key.connectorId}:${key.authorizationSubject}`,
    }).catch(() => {
      console.warn("[audit] event recording failed");
    });
  }
  return revoked;
}

export async function deleteRevokedConnectionInstallation(
  scope: AccessScope,
  key: ConnectionInstallationKey
) {
  const rows = await db
    .delete(connectionInstallations)
    .where(
      and(
        installationConditions(scope, key),
        eq(connectionInstallations.status, "revoked")
      )
    )
    .returning({ id: connectionInstallations.id });
  return rows.length > 0;
}

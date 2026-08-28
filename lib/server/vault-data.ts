import { and, desc, eq } from "drizzle-orm";
import type { AccessScope } from "../access-scope";
import { encryptedSecrets, vaultItems } from "../db/schema";
import { database } from "./database";

const vaultColumns = {
  account: vaultItems.account,
  createdAt: vaultItems.createdAt,
  id: vaultItems.id,
  kind: vaultItems.kind,
  label: vaultItems.label,
  updatedAt: vaultItems.updatedAt,
};

export async function createVaultItem(
  scope: AccessScope,
  record: Omit<typeof vaultItems.$inferInsert, "workspaceId">
) {
  await database()
    .insert(vaultItems)
    .values({ ...record, workspaceId: scope.workspaceId });
}

export async function deleteVaultItem(scope: AccessScope, id: string) {
  const rows = await database()
    .delete(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .returning({ id: vaultItems.id });
  return rows.length > 0;
}

export async function listVaultItems(scope: AccessScope) {
  return database()
    .select(vaultColumns)
    .from(vaultItems)
    .where(eq(vaultItems.workspaceId, scope.workspaceId))
    .orderBy(desc(vaultItems.updatedAt));
}

export async function readVaultItem(scope: AccessScope, id: string) {
  const rows = await database()
    .select(vaultColumns)
    .from(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .limit(1);
  return rows[0];
}

export async function writeEncryptedSecret(
  scope: AccessScope,
  id: string,
  encryptedValue: string
) {
  await database()
    .insert(encryptedSecrets)
    .values({
      encryptedValue,
      id,
      namespace: "vault",
      updatedAt: new Date().toISOString(),
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      set: { encryptedValue, updatedAt: new Date().toISOString() },
      target: [
        encryptedSecrets.workspaceId,
        encryptedSecrets.namespace,
        encryptedSecrets.id,
      ],
    });
}

export async function readEncryptedSecret(scope: AccessScope, id: string) {
  const row = await database().query.encryptedSecrets.findFirst({
    columns: { encryptedValue: true },
    where: and(
      eq(encryptedSecrets.workspaceId, scope.workspaceId),
      eq(encryptedSecrets.namespace, "vault"),
      eq(encryptedSecrets.id, id)
    ),
  });
  return row?.encryptedValue;
}

export async function deleteEncryptedSecret(scope: AccessScope, id: string) {
  await database()
    .delete(encryptedSecrets)
    .where(
      and(
        eq(encryptedSecrets.workspaceId, scope.workspaceId),
        eq(encryptedSecrets.namespace, "vault"),
        eq(encryptedSecrets.id, id)
      )
    );
}

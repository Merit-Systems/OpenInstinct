import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { vaultItemKindSchema } from "@/modules/manager";
import { db, vaultItems } from "@/db";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

type VaultRecord = z.infer<typeof vaultRecordSchema>;

const selection = {
  account: vaultItems.account,
  createdAt: vaultItems.createdAt,
  id: vaultItems.id,
  kind: vaultItems.kind,
  label: vaultItems.label,
  updatedAt: vaultItems.updatedAt,
};

export async function createVaultItem(scope: AccessScope, record: VaultRecord) {
  await db.insert(vaultItems).values({
    ...record,
    workspaceId: scope.workspaceId,
  });
}

export async function listVaultItems(scope: AccessScope) {
  return vaultRecordSchema
    .array()
    .parse(
      await db
        .select(selection)
        .from(vaultItems)
        .where(eq(vaultItems.workspaceId, scope.workspaceId))
        .orderBy(desc(vaultItems.updatedAt))
    );
}

export async function readVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .select(selection)
    .from(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .limit(1);
  return vaultRecordSchema.optional().parse(rows[0]);
}

export async function deleteVaultItem(scope: AccessScope, id: string) {
  const rows = await db
    .delete(vaultItems)
    .where(
      and(eq(vaultItems.workspaceId, scope.workspaceId), eq(vaultItems.id, id))
    )
    .returning({ id: vaultItems.id });
  return rows.length > 0;
}

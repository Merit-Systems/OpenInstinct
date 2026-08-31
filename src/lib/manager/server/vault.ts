import { ensureScope } from "@/db/services/scope";
import { listVaultItems } from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { hasSecret } from "./secret-store";

export async function readManagerVaultItems(scope: AccessScope) {
  await ensureScope(scope);
  const vaultRows = await listVaultItems(scope);
  return Promise.all(
    vaultRows.map(async (row) => ({
      ...row,
      hasSecret: await hasSecret({
        id: row.id,
        namespace: "vault",
        scope,
      }),
    }))
  );
}

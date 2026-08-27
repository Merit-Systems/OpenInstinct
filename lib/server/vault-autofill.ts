import { readVaultItem } from "@/db/services/vault";
import type { AccessScope } from "../access-scope";
import { resolveVaultAutofillValues } from "../vault-autofill";
import { readSecret } from "./secret-store";

export async function prepareVaultAutofill(
  scope: AccessScope,
  vaultItemId: string,
  fields: Parameters<typeof resolveVaultAutofillValues>[2]
) {
  const item = await readVaultItem(scope, vaultItemId);
  if (!item) throw new Error("The selected vault item no longer exists.");

  const secret = await readSecret({ id: item.id, namespace: "vault", scope });
  if (secret === undefined) {
    throw new Error("The selected vault item no longer has a secret value.");
  }
  return resolveVaultAutofillValues(item, secret, fields);
}

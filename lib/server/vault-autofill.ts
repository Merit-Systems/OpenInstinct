import { resolveVaultAutofillValues } from "../vault-autofill";
import { getAppStore } from "./database";
import { readSecret } from "./secret-store";

export async function prepareVaultAutofill(
  vaultItemId: string,
  fields: Parameters<typeof resolveVaultAutofillValues>[2]
) {
  const item = (await (await getAppStore()).listVaultItems()).find(
    ({ id }) => id === vaultItemId
  );
  if (!item) throw new Error("The selected vault item no longer exists.");

  const secret = await readSecret({ id: item.id, namespace: "vault" });
  return resolveVaultAutofillValues(item, secret, fields);
}

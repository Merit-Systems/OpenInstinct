import { randomUUID } from "node:crypto";
import type { AccessScope } from "../access-scope";
import type { ManagerMutation } from "../manager";
import { getModelSettings } from "../model-config";
import { getEnv } from "../runtime-env";
import { selectGatewayModel } from "./settings-data";
import {
  deleteSecret,
  hasSecret,
  secretStoreStatus,
  writeSecret,
} from "./secret-store";
import {
  createVaultItem as insertVaultItem,
  deleteVaultItem,
  listVaultItems,
} from "./vault-data";
import { ensureWorkspace } from "./workspace-data";

export async function readManagerSnapshot(scope: AccessScope) {
  await ensureWorkspace(scope);
  const [vaultRows, modelSettings] = await Promise.all([
    listVaultItems(scope),
    getModelSettings(scope),
  ]);
  const vaultItems = await Promise.all(
    vaultRows.map(async (row) => ({
      ...row,
      hasSecret: await hasSecret({
        id: row.id,
        namespace: "vault",
        scope,
      }),
    }))
  );

  return {
    browser: { available: Boolean(getEnv().KERNEL_API_KEY) },
    runtime: { inference: modelSettings.modelId },
    secretStore: secretStoreStatus(),
    vaultItems,
  };
}

export async function applyManagerMutation(
  scope: AccessScope,
  mutation: ManagerMutation
) {
  await ensureWorkspace(scope);

  switch (mutation.action) {
    case "model.select":
      await selectGatewayModel(scope, mutation.modelId);
      break;
    case "vault.create":
      await createVaultItem(scope, mutation.input);
      break;
    case "vault.delete":
      await removeVaultItem(scope, mutation.id);
      break;
  }

  return readManagerSnapshot(scope);
}

async function createVaultItem(
  scope: AccessScope,
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeSecret({ id, namespace: "vault", scope, value: input.secret });

  try {
    await insertVaultItem(scope, {
      account: input.account,
      createdAt: now,
      id,
      kind: input.kind,
      label: input.label,
      updatedAt: now,
    });
  } catch (error) {
    await deleteSecret({ id, namespace: "vault", scope });
    throw error;
  }
}

async function removeVaultItem(scope: AccessScope, id: string) {
  const deleted = await deleteVaultItem(scope, id);
  if (!deleted) return;
  await deleteSecret({ id, namespace: "vault", scope });
}

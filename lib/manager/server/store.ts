import { randomUUID } from "node:crypto";
import { ensureScope } from "@/db/services/scope";
import { selectGatewayModel } from "@/db/services/settings";
import {
  createVaultItem as insertVaultItem,
  deleteVaultItem,
} from "@/db/services/vault";
import type { AccessScope } from "../../access-scope";
import { getGoogleWorkspaceConnection } from "../../google-workspace/server";
import { getModelSettings } from "../../model-config";
import type { ManagerMutation } from "..";
import { deleteSecret, writeSecret } from "./secret-store";
import { readManagerVaultItems } from "./vault";

export async function readManagerSnapshot(scope: AccessScope) {
  const [googleWorkspace, vaultRows, modelSettings] = await Promise.all([
    getGoogleWorkspaceConnection(scope),
    readManagerVaultItems(scope),
    getModelSettings(scope),
  ]);

  return {
    browser: { available: true },
    googleWorkspace,
    runtime: { inference: modelSettings.modelId },
    secretStore: {
      available: true,
      description:
        "Secrets are encrypted for this workspace before database storage.",
      kind: "Encrypted vault",
    },
    vaultItems: vaultRows,
  };
}

export async function applyManagerMutation(
  scope: AccessScope,
  mutation: ManagerMutation
) {
  await ensureScope(scope);

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
  await writeSecret({ id, scope, value: input.secret });

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
    await deleteSecret({ id, scope });
    throw error;
  }
}

async function removeVaultItem(scope: AccessScope, id: string) {
  const deleted = await deleteVaultItem(scope, id);
  if (!deleted) return;
  await deleteSecret({ id, scope });
}

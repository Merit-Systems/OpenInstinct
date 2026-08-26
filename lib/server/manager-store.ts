import { randomUUID } from "node:crypto";
import type { AccessScope } from "../access-scope";
import { getBrowserSettings, selectBrowserMode } from "../browser-config";
import {
  type ConnectionProvider,
  type ManagerMutation,
  managerSnapshotSchema,
} from "../manager";
import { getModelSettings } from "../model-config";
import { getAppStore } from "./app-store";
import {
  deleteSecret,
  hasSecret,
  readSecret,
  secretStoreStatus,
  writeSecret,
} from "./secret-store";
import {
  parseTelegramCredentials,
  prepareTelegramConnection,
} from "./telegram";

export async function readManagerSnapshot(scope: AccessScope) {
  const store = await getAppStore();
  await store.ensureScope(scope);
  const [browser, connectionRows, vaultRows, modelSettings] = await Promise.all(
    [
      getBrowserSettings(scope),
      store.listConnections(scope),
      store.listVaultItems(scope),
      getModelSettings(scope),
    ]
  );
  const [connections, vaultItems] = await Promise.all([
    Promise.all(
      connectionRows.map(async (row) => ({
        ...row,
        hasSecret: await hasSecret({
          id: row.id,
          namespace: "connection",
          scope,
        }),
      }))
    ),
    Promise.all(
      vaultRows.map(async (row) => ({
        ...row,
        hasSecret: await hasSecret({
          id: row.id,
          namespace: "vault",
          scope,
        }),
      }))
    ),
  ]);

  return managerSnapshotSchema.parse({
    browser,
    connections,
    runtime: {
      inference: modelSettings.modelId,
      mode: scope.mode === "local" ? "local-first" : "hosted",
      source: modelSettings.source,
    },
    secretStore: secretStoreStatus(),
    vaultItems,
  });
}

export async function applyManagerMutation(
  scope: AccessScope,
  mutation: ManagerMutation
) {
  const store = await getAppStore();
  await store.ensureScope(scope);

  switch (mutation.action) {
    case "browser.select":
      await selectBrowserMode(scope, mutation.mode);
      break;
    case "connection.create":
      await createConnection(scope, mutation.input);
      break;
    case "connection.delete":
      await removeRecord(scope, "connection", mutation.id);
      break;
    case "model.select":
      await store.selectGatewayModel(scope, mutation.modelId);
      break;
    case "vault.create":
      await createVaultItem(scope, mutation.input);
      break;
    case "vault.delete":
      await removeRecord(scope, "vault", mutation.id);
      break;
  }

  return readManagerSnapshot(scope);
}

async function readConnectionSecret(
  scope: AccessScope,
  provider: ConnectionProvider
) {
  const row = await (
    await getAppStore()
  ).readConnectionByProvider(scope, provider);
  return row
    ? await readSecret({ id: row.id, namespace: "connection", scope })
    : undefined;
}

export async function readTelegramCredentials(scope: AccessScope) {
  const value = await readConnectionSecret(scope, "telegram");
  return value ? parseTelegramCredentials(value) : undefined;
}

async function createConnection(
  scope: AccessScope,
  input: Extract<ManagerMutation, { action: "connection.create" }>["input"]
) {
  const telegram =
    input.provider === "telegram"
      ? await prepareTelegramConnection(input.secret)
      : undefined;
  const connection = telegram ? { ...input, ...telegram } : input;
  const id = randomUUID();
  const now = new Date().toISOString();

  if (connection.secret) {
    await writeSecret({
      id,
      namespace: "connection",
      scope,
      value: connection.secret,
    });
  }

  const store = await getAppStore();
  let replacedIds: readonly string[];
  try {
    replacedIds = await store.createConnection(
      scope,
      {
        account: connection.account,
        createdAt: now,
        endpoint: connection.endpoint,
        id,
        label: connection.label,
        provider: connection.provider,
        updatedAt: now,
      },
      connection.provider === "telegram"
    );
    if (connection.provider === "local-model") {
      await store.selectLocalModel(scope);
    }
  } catch (error) {
    await deleteSecret({ id, namespace: "connection", scope });
    throw error;
  }

  await Promise.all(
    replacedIds.map((replacedId) =>
      deleteSecret({ id: replacedId, namespace: "connection", scope })
    )
  );
}

async function createVaultItem(
  scope: AccessScope,
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeSecret({ id, namespace: "vault", scope, value: input.secret });

  try {
    await (
      await getAppStore()
    ).createVaultItem(scope, {
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

async function removeRecord(
  scope: AccessScope,
  namespace: "connection" | "vault",
  id: string
) {
  const store = await getAppStore();
  const deleted =
    namespace === "connection"
      ? await store.deleteConnection(scope, id)
      : await store.deleteVaultItem(scope, id);
  if (!deleted) return;
  await deleteSecret({ id, namespace, scope });
}

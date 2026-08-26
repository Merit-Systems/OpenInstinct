import { randomUUID } from "node:crypto";
import { getBrowserSettings, selectBrowserMode } from "../browser-config";
import { getModelSettings } from "../model-config";
import {
  type ConnectionProvider,
  type ManagerMutation,
  managerSnapshotSchema,
} from "../manager";
import { getAppStore } from "./database";
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

export async function readManagerSnapshot() {
  const store = await getAppStore();
  const [browser, connectionRows, vaultRows, modelSettings] = await Promise.all(
    [
      getBrowserSettings(),
      store.listConnections(),
      store.listVaultItems(),
      getModelSettings(),
    ]
  );
  const [connections, vaultItems] = await Promise.all([
    Promise.all(
      connectionRows.map(async (row) => ({
        ...row,
        hasSecret: await hasSecret({ id: row.id, namespace: "connection" }),
      }))
    ),
    Promise.all(
      vaultRows.map(async (row) => ({
        ...row,
        hasSecret: await hasSecret({ id: row.id, namespace: "vault" }),
      }))
    ),
  ]);

  return managerSnapshotSchema.parse({
    browser,
    connections,
    runtime: {
      inference: modelSettings.modelId,
      mode: "local-first",
      source: modelSettings.source,
    },
    secretStore: secretStoreStatus(),
    vaultItems,
  });
}

export async function applyManagerMutation(mutation: ManagerMutation) {
  switch (mutation.action) {
    case "browser.select":
      await selectBrowserMode(mutation.mode);
      break;
    case "connection.create":
      await createConnection(mutation.input);
      break;
    case "connection.delete":
      await removeRecord("connection", mutation.id);
      break;
    case "model.select":
      await (await getAppStore()).selectGatewayModel(mutation.modelId);
      break;
    case "vault.create":
      await createVaultItem(mutation.input);
      break;
    case "vault.delete":
      await removeRecord("vault", mutation.id);
      break;
  }

  return readManagerSnapshot();
}

async function readConnectionSecret(provider: ConnectionProvider) {
  const row = await (await getAppStore()).readConnectionByProvider(provider);
  return row
    ? await readSecret({ id: row.id, namespace: "connection" })
    : undefined;
}

export async function readTelegramCredentials() {
  const value = await readConnectionSecret("telegram");
  return value ? parseTelegramCredentials(value) : undefined;
}

async function createConnection(
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
      value: connection.secret,
    });
  }

  const store = await getAppStore();
  let replacedIds: readonly string[];
  try {
    replacedIds = await store.createConnection(
      {
        account: connection.account,
        createdAt: now,
        endpoint: connection.endpoint,
        id,
        label: connection.label,
        provider: connection.provider,
        updatedAt: now,
      },
      connection.provider === "kernel" || connection.provider === "telegram"
    );
    if (connection.provider === "local-model") {
      await store.selectLocalModel();
    }
  } catch (error) {
    await deleteSecret({ id, namespace: "connection" });
    throw error;
  }

  await Promise.all(
    replacedIds.map((replacedId) =>
      deleteSecret({ id: replacedId, namespace: "connection" })
    )
  );
}

async function createVaultItem(
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeSecret({ id, namespace: "vault", value: input.secret });

  try {
    await (
      await getAppStore()
    ).createVaultItem({
      account: input.account,
      createdAt: now,
      id,
      kind: input.kind,
      label: input.label,
      updatedAt: now,
    });
  } catch (error) {
    await deleteSecret({ id, namespace: "vault" });
    throw error;
  }
}

async function removeRecord(namespace: "connection" | "vault", id: string) {
  await deleteSecret({ id, namespace });
  const store = await getAppStore();
  if (namespace === "connection") {
    await store.deleteConnection(id);
  } else {
    await store.deleteVaultItem(id);
  }
}

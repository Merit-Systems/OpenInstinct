import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getLocalDataDirectory } from "../data-directory";
import {
  type ConnectionProvider,
  type ManagerMutation,
  managerSnapshotSchema,
} from "../manager";
import {
  deleteSecret,
  hasSecret,
  readSecret,
  secretStoreStatus,
  writeSecret,
} from "./secret-store";
import { getModelSettings } from "../model-config";

const connectionRowSchema = z.object({
  account: z.string(),
  created_at: z.string(),
  endpoint: z.string(),
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  updated_at: z.string(),
});

const vaultRowSchema = z.object({
  account: z.string(),
  created_at: z.string(),
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  updated_at: z.string(),
});

export async function readManagerSnapshot() {
  const database = openDatabase();

  try {
    const connectionRows = z
      .array(connectionRowSchema)
      .parse(
        database
          .prepare("SELECT * FROM connections ORDER BY updated_at DESC")
          .all()
      );
    const vaultRows = z
      .array(vaultRowSchema)
      .parse(
        database
          .prepare("SELECT * FROM vault_items ORDER BY updated_at DESC")
          .all()
      );

    const [connections, vaultItems] = await Promise.all([
      Promise.all(
        connectionRows.map(async (row) => ({
          account: row.account,
          createdAt: row.created_at,
          endpoint: row.endpoint,
          hasSecret: await hasSecret({ id: row.id, namespace: "connection" }),
          id: row.id,
          label: row.label,
          provider: row.provider,
          updatedAt: row.updated_at,
        }))
      ),
      Promise.all(
        vaultRows.map(async (row) => ({
          account: row.account,
          createdAt: row.created_at,
          hasSecret: await hasSecret({ id: row.id, namespace: "vault" }),
          id: row.id,
          kind: row.kind,
          label: row.label,
          updatedAt: row.updated_at,
        }))
      ),
    ]);

    const modelSettings = getModelSettings();
    return managerSnapshotSchema.parse({
      connections,
      runtime: {
        inference: modelSettings.modelId,
        mode: "local-first",
        source: modelSettings.source,
      },
      secretStore: secretStoreStatus(),
      vaultItems,
    });
  } finally {
    database.close();
  }
}

export async function applyManagerMutation(mutation: ManagerMutation) {
  switch (mutation.action) {
    case "connection.create":
      await createConnection(mutation.input);
      break;
    case "connection.delete":
      await removeRecord("connections", "connection", mutation.id);
      break;
    case "model.select":
      selectGatewayModel(mutation.modelId);
      break;
    case "vault.create":
      await createVaultItem(mutation.input);
      break;
    case "vault.delete":
      await removeRecord("vault_items", "vault", mutation.id);
      break;
  }

  return readManagerSnapshot();
}

export async function readConnectionSecret(provider: ConnectionProvider) {
  const database = openDatabase();

  try {
    const row = connectionRowSchema
      .pick({ id: true })
      .nullish()
      .parse(
        database
          .prepare(
            "SELECT id FROM connections WHERE provider = ? ORDER BY updated_at DESC LIMIT 1"
          )
          .get(provider)
      );

    return row
      ? await readSecret({ id: row.id, namespace: "connection" })
      : undefined;
  } finally {
    database.close();
  }
}

async function createConnection(
  input: Extract<ManagerMutation, { action: "connection.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const replacedIds: string[] = [];

  if (input.secret) {
    await writeSecret({ id, namespace: "connection", value: input.secret });
  }

  const database = openDatabase();
  try {
    if (input.provider === "kernel") {
      replacedIds.push(
        ...z
          .array(connectionRowSchema.pick({ id: true }))
          .parse(
            database
              .prepare("SELECT id FROM connections WHERE provider = ?")
              .all(input.provider)
          )
          .map((row) => row.id)
      );
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(
          "INSERT INTO connections (id, provider, label, endpoint, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          id,
          input.provider,
          input.label,
          input.endpoint,
          input.account,
          now,
          now
        );

      if (input.provider === "kernel") {
        database
          .prepare("DELETE FROM connections WHERE provider = ? AND id <> ?")
          .run(input.provider, id);
      }
      if (input.provider === "local-model") {
        writeSetting(database, "model_source", "local");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    await deleteSecret({ id, namespace: "connection" });
    throw error;
  } finally {
    database.close();
  }

  await Promise.all(
    replacedIds.map((replacedId) =>
      deleteSecret({ id: replacedId, namespace: "connection" })
    )
  );
}

function selectGatewayModel(modelId: string) {
  const database = openDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      writeSetting(database, "gateway_model", modelId);
      writeSetting(database, "model_source", "gateway");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

function writeSetting(database: DatabaseSync, key: string, value: string) {
  database
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

async function createVaultItem(
  input: Extract<ManagerMutation, { action: "vault.create" }>["input"]
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await writeSecret({ id, namespace: "vault", value: input.secret });

  const database = openDatabase();
  try {
    database
      .prepare(
        "INSERT INTO vault_items (id, kind, label, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, input.kind, input.label, input.account, now, now);
  } catch (error) {
    await deleteSecret({ id, namespace: "vault" });
    throw error;
  } finally {
    database.close();
  }
}

async function removeRecord(
  table: "connections" | "vault_items",
  namespace: "connection" | "vault",
  id: string
) {
  await deleteSecret({ id, namespace });
  const database = openDatabase();
  try {
    database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  } finally {
    database.close();
  }
}

function openDatabase() {
  const directory = getLocalDataDirectory();
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const filename = join(directory, "manager.sqlite");
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return database;
}

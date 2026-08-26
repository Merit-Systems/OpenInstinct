import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import type { AccessScope } from "../access-scope";
import { getLocalDataDirectory } from "../data-directory";
import { getDeploymentMode } from "../deployment-mode";
import { getEnv } from "../runtime-env";
import { connectionProviderSchema, vaultItemKindSchema } from "../manager";

const connectionRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  endpoint: z.string(),
  id: z.string(),
  label: z.string(),
  provider: connectionProviderSchema,
  updatedAt: z.string(),
});

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

const modelStorageSchema = z.object({
  localModel: connectionRecordSchema.optional(),
  settings: z.record(z.string(), z.string()),
});

const encryptedSecretSchema = z
  .object({ encryptedValue: z.string() })
  .optional();

type ConnectionRecord = z.infer<typeof connectionRecordSchema>;
type VaultRecord = z.infer<typeof vaultRecordSchema>;

export interface AppStore {
  claimSession(scope: AccessScope, sessionId: string): Promise<void>;
  createConnection(
    scope: AccessScope,
    record: ConnectionRecord,
    replaceProvider: boolean
  ): Promise<readonly string[]>;
  createVaultItem(scope: AccessScope, record: VaultRecord): Promise<void>;
  deleteConnection(scope: AccessScope, id: string): Promise<boolean>;
  deleteEncryptedSecret(
    scope: AccessScope,
    namespace: "connection" | "vault",
    id: string
  ): Promise<void>;
  deleteVaultItem(scope: AccessScope, id: string): Promise<boolean>;
  ensureScope(scope: AccessScope): Promise<void>;
  initialize(): Promise<void>;
  isSessionOwned(scope: AccessScope, sessionId: string): Promise<boolean>;
  listConnections(scope: AccessScope): Promise<readonly ConnectionRecord[]>;
  listOwnedSessionIds(scope: AccessScope): Promise<ReadonlySet<string>>;
  listVaultItems(scope: AccessScope): Promise<readonly VaultRecord[]>;
  readConnectionByProvider(
    scope: AccessScope,
    provider: ConnectionRecord["provider"]
  ): Promise<ConnectionRecord | undefined>;
  readEncryptedSecret(
    scope: AccessScope,
    namespace: "connection" | "vault",
    id: string
  ): Promise<string | undefined>;
  readModelStorage(
    scope: AccessScope
  ): Promise<z.infer<typeof modelStorageSchema>>;
  selectGatewayModel(scope: AccessScope, modelId: string): Promise<void>;
  selectLocalModel(scope: AccessScope): Promise<void>;
  writeEncryptedSecret(
    scope: AccessScope,
    namespace: "connection" | "vault",
    id: string,
    encryptedValue: string
  ): Promise<void>;
}

let storePromise: Promise<AppStore> | undefined;

export function getAppStore() {
  storePromise ??= createAppStore();
  return storePromise;
}

async function createAppStore() {
  const databaseUrl = getEnv().DATABASE_URL;
  const mode = getDeploymentMode();
  let store: AppStore;

  if (databaseUrl?.startsWith("postgres")) {
    store = createPostgresStore(databaseUrl);
  } else {
    if (mode === "hosted") {
      throw new Error("Hosted mode requires a Postgres DATABASE_URL.");
    }
    const filename = databaseUrl?.startsWith("file:")
      ? fileURLToPath(databaseUrl)
      : join(getLocalDataDirectory(), "manager.sqlite");
    store = createSqliteStore(filename);
  }

  await store.initialize();
  return store;
}

export function createSqliteStore(filename: string): AppStore {
  mkdirSync(dirname(filename), { mode: 0o700, recursive: true });
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);

  const all = (query: string, parameters: readonly SQLInputValue[] = []) =>
    database.prepare(query).all(...parameters);
  const get = (query: string, parameters: readonly SQLInputValue[] = []) =>
    database.prepare(query).get(...parameters);
  const run = (query: string, parameters: readonly SQLInputValue[] = []) =>
    database.prepare(query).run(...parameters);

  return {
    async claimSession(scope, sessionId) {
      run(
        "INSERT OR IGNORE INTO agent_sessions (session_id, workspace_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?)",
        [sessionId, scope.workspaceId, scope.userId, new Date().toISOString()]
      );
    },
    async createConnection(scope, record, replaceProvider) {
      const replaced = replaceProvider
        ? z
            .array(z.object({ id: z.string() }))
            .parse(
              all(
                "SELECT id FROM connections WHERE workspace_id = ? AND provider = ?",
                [scope.workspaceId, record.provider]
              )
            )
        : [];
      database.exec("BEGIN IMMEDIATE");
      try {
        run(
          "INSERT INTO connections (id, workspace_id, provider, label, endpoint, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            record.id,
            scope.workspaceId,
            record.provider,
            record.label,
            record.endpoint,
            record.account,
            record.createdAt,
            record.updatedAt,
          ]
        );
        if (replaceProvider) {
          run(
            "DELETE FROM connections WHERE workspace_id = ? AND provider = ? AND id <> ?",
            [scope.workspaceId, record.provider, record.id]
          );
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return replaced.map((row) => row.id);
    },
    async createVaultItem(scope, record) {
      run(
        "INSERT INTO vault_items (id, workspace_id, kind, label, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          record.id,
          scope.workspaceId,
          record.kind,
          record.label,
          record.account,
          record.createdAt,
          record.updatedAt,
        ]
      );
    },
    async deleteConnection(scope, id) {
      return (
        run("DELETE FROM connections WHERE workspace_id = ? AND id = ?", [
          scope.workspaceId,
          id,
        ]).changes > 0
      );
    },
    async deleteEncryptedSecret(scope, namespace, id) {
      run(
        "DELETE FROM encrypted_secrets WHERE workspace_id = ? AND namespace = ? AND id = ?",
        [scope.workspaceId, namespace, id]
      );
    },
    async deleteVaultItem(scope, id) {
      return (
        run("DELETE FROM vault_items WHERE workspace_id = ? AND id = ?", [
          scope.workspaceId,
          id,
        ]).changes > 0
      );
    },
    async ensureScope(scope) {
      const now = new Date().toISOString();
      run("INSERT OR IGNORE INTO workspaces (id, created_at) VALUES (?, ?)", [
        scope.workspaceId,
        now,
      ]);
      run(
        "INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        [scope.workspaceId, scope.userId, now]
      );
    },
    async initialize() {
      initializeSqlite(database);
    },
    async isSessionOwned(scope, sessionId) {
      if (scope.mode === "local") return true;
      return Boolean(
        get(
          "SELECT 1 FROM agent_sessions WHERE workspace_id = ? AND session_id = ?",
          [scope.workspaceId, sessionId]
        )
      );
    },
    async listConnections(scope) {
      return connectionRecordSchema
        .array()
        .parse(
          all(
            "SELECT account, created_at AS createdAt, endpoint, id, label, provider, updated_at AS updatedAt FROM connections WHERE workspace_id = ? ORDER BY updated_at DESC",
            [scope.workspaceId]
          )
        );
    },
    async listOwnedSessionIds(scope) {
      if (scope.mode === "local") return new Set<string>();
      const rows = z
        .array(z.object({ sessionId: z.string() }))
        .parse(
          all(
            "SELECT session_id AS sessionId FROM agent_sessions WHERE workspace_id = ?",
            [scope.workspaceId]
          )
        );
      return new Set(rows.map((row) => row.sessionId));
    },
    async listVaultItems(scope) {
      return vaultRecordSchema
        .array()
        .parse(
          all(
            "SELECT account, created_at AS createdAt, id, kind, label, updated_at AS updatedAt FROM vault_items WHERE workspace_id = ? ORDER BY updated_at DESC",
            [scope.workspaceId]
          )
        );
    },
    async readConnectionByProvider(scope, provider) {
      return connectionRecordSchema
        .optional()
        .parse(
          get(
            "SELECT account, created_at AS createdAt, endpoint, id, label, provider, updated_at AS updatedAt FROM connections WHERE workspace_id = ? AND provider = ? ORDER BY updated_at DESC LIMIT 1",
            [scope.workspaceId, provider]
          )
        );
    },
    async readEncryptedSecret(scope, namespace, id) {
      return encryptedSecretSchema.parse(
        get(
          "SELECT encrypted_value AS encryptedValue FROM encrypted_secrets WHERE workspace_id = ? AND namespace = ? AND id = ?",
          [scope.workspaceId, namespace, id]
        )
      )?.encryptedValue;
    },
    async readModelStorage(scope) {
      const settingRows = z
        .array(z.object({ key: z.string(), value: z.string() }))
        .parse(
          all(
            "SELECT key, value FROM settings WHERE workspace_id = ? AND key IN ('gateway_model', 'model_source')",
            [scope.workspaceId]
          )
        );
      const localModel = await this.readConnectionByProvider(
        scope,
        "local-model"
      );
      return modelStorageSchema.parse({
        localModel: localModel?.endpoint.trim() === "" ? undefined : localModel,
        settings: Object.fromEntries(
          settingRows.map((row) => [row.key, row.value])
        ),
      });
    },
    async selectGatewayModel(scope, modelId) {
      writeSqliteSetting(database, scope.workspaceId, "gateway_model", modelId);
      writeSqliteSetting(
        database,
        scope.workspaceId,
        "model_source",
        "gateway"
      );
    },
    async selectLocalModel(scope) {
      writeSqliteSetting(database, scope.workspaceId, "model_source", "local");
    },
    async writeEncryptedSecret(scope, namespace, id, encryptedValue) {
      run(
        "INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, namespace, id) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at",
        [
          scope.workspaceId,
          namespace,
          id,
          encryptedValue,
          new Date().toISOString(),
        ]
      );
    },
  };
}

function initializeSqlite(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'local:personal',
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'local:personal',
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addSqliteColumnIfMissing(
    database,
    "connections",
    "workspace_id",
    "TEXT NOT NULL DEFAULT 'local:personal'"
  );
  addSqliteColumnIfMissing(
    database,
    "vault_items",
    "workspace_id",
    "TEXT NOT NULL DEFAULT 'local:personal'"
  );

  const settingsColumns = sqliteColumns(database, "settings");
  if (settingsColumns.length > 0 && !settingsColumns.includes("workspace_id")) {
    database.exec(`
      ALTER TABLE settings RENAME TO settings_legacy;
      CREATE TABLE settings (
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
      );
      INSERT INTO settings (workspace_id, key, value)
      SELECT 'local:personal', key, value FROM settings_legacy;
      DROP TABLE settings_legacy;
    `);
  } else {
    database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
      );
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS encrypted_secrets (
      workspace_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, namespace, id)
    );
    CREATE INDEX IF NOT EXISTS connections_workspace_provider_idx
      ON connections (workspace_id, provider);
    CREATE INDEX IF NOT EXISTS vault_items_workspace_updated_idx
      ON vault_items (workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx
      ON agent_sessions (workspace_id, created_at DESC);
  `);
}

function sqliteColumns(database: DatabaseSync, table: string) {
  return z
    .array(z.object({ name: z.string() }))
    .parse(database.prepare(`PRAGMA table_info(${table})`).all())
    .map((column) => column.name);
}

function addSqliteColumnIfMissing(
  database: DatabaseSync,
  table: "connections" | "vault_items",
  column: string,
  definition: string
) {
  if (!sqliteColumns(database, table).includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function writeSqliteSetting(
  database: DatabaseSync,
  workspaceId: string,
  key: string,
  value: string
) {
  database
    .prepare(
      "INSERT INTO settings (workspace_id, key, value) VALUES (?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value"
    )
    .run(workspaceId, key, value);
}

function createPostgresStore(databaseUrl: string): AppStore {
  const sql = neon(databaseUrl);
  const query = (text: string, parameters: readonly unknown[] = []) =>
    sql.query(text, [...parameters]);

  return {
    async claimSession(scope, sessionId) {
      await query(
        "INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id) DO NOTHING",
        [sessionId, scope.workspaceId, scope.userId, new Date().toISOString()]
      );
    },
    async createConnection(scope, record, replaceProvider) {
      const replaced = replaceProvider
        ? z
            .array(z.object({ id: z.string() }))
            .parse(
              await query(
                "SELECT id FROM connections WHERE workspace_id = $1 AND provider = $2",
                [scope.workspaceId, record.provider]
              )
            )
        : [];
      await query(
        "INSERT INTO connections (id, workspace_id, provider, label, endpoint, account, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          record.id,
          scope.workspaceId,
          record.provider,
          record.label,
          record.endpoint,
          record.account,
          record.createdAt,
          record.updatedAt,
        ]
      );
      if (replaceProvider) {
        await query(
          "DELETE FROM connections WHERE workspace_id = $1 AND provider = $2 AND id <> $3",
          [scope.workspaceId, record.provider, record.id]
        );
      }
      return replaced.map((row) => row.id);
    },
    async createVaultItem(scope, record) {
      await query(
        "INSERT INTO vault_items (id, workspace_id, kind, label, account, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          record.id,
          scope.workspaceId,
          record.kind,
          record.label,
          record.account,
          record.createdAt,
          record.updatedAt,
        ]
      );
    },
    async deleteConnection(scope, id) {
      const rows = await query(
        "DELETE FROM connections WHERE workspace_id = $1 AND id = $2 RETURNING id",
        [scope.workspaceId, id]
      );
      return rows.length > 0;
    },
    async deleteEncryptedSecret(scope, namespace, id) {
      await query(
        "DELETE FROM encrypted_secrets WHERE workspace_id = $1 AND namespace = $2 AND id = $3",
        [scope.workspaceId, namespace, id]
      );
    },
    async deleteVaultItem(scope, id) {
      const rows = await query(
        "DELETE FROM vault_items WHERE workspace_id = $1 AND id = $2 RETURNING id",
        [scope.workspaceId, id]
      );
      return rows.length > 0;
    },
    async ensureScope(scope) {
      const now = new Date().toISOString();
      await sql.transaction((transaction) => [
        transaction.query(
          "INSERT INTO workspaces (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
          [scope.workspaceId, now]
        ),
        transaction.query(
          "INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ($1, $2, 'owner', $3) ON CONFLICT (workspace_id, user_id) DO NOTHING",
          [scope.workspaceId, scope.userId, now]
        ),
      ]);
    },
    async initialize() {
      await initializePostgres(sql);
    },
    async isSessionOwned(scope, sessionId) {
      const rows = await query(
        "SELECT 1 FROM agent_sessions WHERE workspace_id = $1 AND session_id = $2 LIMIT 1",
        [scope.workspaceId, sessionId]
      );
      return rows.length > 0;
    },
    async listConnections(scope) {
      return connectionRecordSchema
        .array()
        .parse(
          await query(
            'SELECT account, created_at AS "createdAt", endpoint, id, label, provider, updated_at AS "updatedAt" FROM connections WHERE workspace_id = $1 ORDER BY updated_at DESC',
            [scope.workspaceId]
          )
        );
    },
    async listOwnedSessionIds(scope) {
      const rows = z
        .array(z.object({ sessionId: z.string() }))
        .parse(
          await query(
            'SELECT session_id AS "sessionId" FROM agent_sessions WHERE workspace_id = $1',
            [scope.workspaceId]
          )
        );
      return new Set(rows.map((row) => row.sessionId));
    },
    async listVaultItems(scope) {
      return vaultRecordSchema
        .array()
        .parse(
          await query(
            'SELECT account, created_at AS "createdAt", id, kind, label, updated_at AS "updatedAt" FROM vault_items WHERE workspace_id = $1 ORDER BY updated_at DESC',
            [scope.workspaceId]
          )
        );
    },
    async readConnectionByProvider(scope, provider) {
      const rows = await query(
        'SELECT account, created_at AS "createdAt", endpoint, id, label, provider, updated_at AS "updatedAt" FROM connections WHERE workspace_id = $1 AND provider = $2 ORDER BY updated_at DESC LIMIT 1',
        [scope.workspaceId, provider]
      );
      return connectionRecordSchema.optional().parse(rows[0]);
    },
    async readEncryptedSecret(scope, namespace, id) {
      const rows = await query(
        'SELECT encrypted_value AS "encryptedValue" FROM encrypted_secrets WHERE workspace_id = $1 AND namespace = $2 AND id = $3',
        [scope.workspaceId, namespace, id]
      );
      return encryptedSecretSchema.parse(rows[0])?.encryptedValue;
    },
    async readModelStorage(scope) {
      const settingRows = z
        .array(z.object({ key: z.string(), value: z.string() }))
        .parse(
          await query(
            "SELECT key, value FROM settings WHERE workspace_id = $1 AND key IN ('gateway_model', 'model_source')",
            [scope.workspaceId]
          )
        );
      const localModel = await this.readConnectionByProvider(
        scope,
        "local-model"
      );
      return modelStorageSchema.parse({
        localModel: localModel?.endpoint.trim() === "" ? undefined : localModel,
        settings: Object.fromEntries(
          settingRows.map((row) => [row.key, row.value])
        ),
      });
    },
    async selectGatewayModel(scope, modelId) {
      await writePostgresSetting(
        sql,
        scope.workspaceId,
        "gateway_model",
        modelId
      );
      await writePostgresSetting(
        sql,
        scope.workspaceId,
        "model_source",
        "gateway"
      );
    },
    async selectLocalModel(scope) {
      await writePostgresSetting(
        sql,
        scope.workspaceId,
        "model_source",
        "local"
      );
    },
    async writeEncryptedSecret(scope, namespace, id, encryptedValue) {
      await query(
        "INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, namespace, id) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = EXCLUDED.updated_at",
        [
          scope.workspaceId,
          namespace,
          id,
          encryptedValue,
          new Date().toISOString(),
        ]
      );
    },
  };
}

async function initializePostgres(sql: NeonQueryFunction<false, false>) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS workspace_memberships (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, endpoint TEXT NOT NULL, account TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, account TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (workspace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (workspace_id, key))`,
    `CREATE TABLE IF NOT EXISTS agent_sessions (session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS encrypted_secrets (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, id TEXT NOT NULL, encrypted_value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, namespace, id))`,
    `CREATE INDEX IF NOT EXISTS connections_workspace_provider_idx ON connections (workspace_id, provider)`,
    `CREATE INDEX IF NOT EXISTS vault_items_workspace_updated_idx ON vault_items (workspace_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx ON agent_sessions (workspace_id, created_at DESC)`,
  ];
  for (const statement of statements) await sql.query(statement);
}

async function writePostgresSetting(
  sql: NeonQueryFunction<false, false>,
  workspaceId: string,
  key: string,
  value: string
) {
  await sql.query(
    "INSERT INTO settings (workspace_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value",
    [workspaceId, key, value]
  );
}

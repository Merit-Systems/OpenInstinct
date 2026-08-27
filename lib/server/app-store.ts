import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import type { AccessScope } from "../access-scope";
import { chatListSchema, type ChatSummary, type SaveChat } from "../chat";
import { vaultItemKindSchema } from "../manager";
import { getEnv } from "../runtime-env";

const vaultRecordSchema = z.object({
  account: z.string(),
  createdAt: z.string(),
  id: z.string(),
  kind: vaultItemKindSchema,
  label: z.string(),
  updatedAt: z.string(),
});

const chatRowSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  createdAt: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string(),
});

const browserSessionRecordSchema = z.object({
  createdAt: z.string(),
  sessionId: z.string().min(1),
});

type BrowserSessionRecord = z.infer<typeof browserSessionRecordSchema>;
type VaultRecord = z.infer<typeof vaultRecordSchema>;

interface AppStore {
  claimSession(scope: AccessScope, sessionId: string): Promise<void>;
  createBrowserSession(
    scope: AccessScope,
    record: BrowserSessionRecord
  ): Promise<void>;
  createVaultItem(scope: AccessScope, record: VaultRecord): Promise<void>;
  deleteBrowserSession(scope: AccessScope, sessionId: string): Promise<boolean>;
  deleteEncryptedSecret(scope: AccessScope, id: string): Promise<void>;
  deleteVaultItem(scope: AccessScope, id: string): Promise<boolean>;
  ensureScope(scope: AccessScope): Promise<void>;
  initialize(): Promise<void>;
  isSessionOwned(scope: AccessScope, sessionId: string): Promise<boolean>;
  listBrowserSessions(
    scope: AccessScope
  ): Promise<readonly BrowserSessionRecord[]>;
  listChats(scope: AccessScope): Promise<readonly ChatSummary[]>;
  listOwnedSessionIds(scope: AccessScope): Promise<ReadonlySet<string>>;
  listVaultItems(scope: AccessScope): Promise<readonly VaultRecord[]>;
  readBrowserSession(
    scope: AccessScope,
    sessionId: string
  ): Promise<BrowserSessionRecord | undefined>;
  readEncryptedSecret(
    scope: AccessScope,
    id: string
  ): Promise<string | undefined>;
  readGatewayModel(scope: AccessScope): Promise<string | undefined>;
  saveChat(scope: AccessScope, chat: SaveChat): Promise<void>;
  selectGatewayModel(scope: AccessScope, modelId: string): Promise<void>;
  writeEncryptedSecret(
    scope: AccessScope,
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
  if (
    !databaseUrl?.startsWith("postgres://") &&
    !databaseUrl?.startsWith("postgresql://")
  ) {
    throw new Error("A Postgres DATABASE_URL is required.");
  }

  const store = createPostgresStore(databaseUrl);
  await store.initialize();
  return store;
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
    async createBrowserSession(scope, record) {
      await query(
        "INSERT INTO browser_sessions (session_id, workspace_id, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
        [record.sessionId, scope.workspaceId, scope.userId, record.createdAt]
      );
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
    async deleteBrowserSession(scope, sessionId) {
      const rows = await query(
        "DELETE FROM browser_sessions WHERE workspace_id = $1 AND session_id = $2 RETURNING session_id",
        [scope.workspaceId, sessionId]
      );
      return rows.length > 0;
    },
    async deleteEncryptedSecret(scope, id) {
      await query(
        "DELETE FROM encrypted_secrets WHERE workspace_id = $1 AND namespace = 'vault' AND id = $2",
        [scope.workspaceId, id]
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
    async listBrowserSessions(scope) {
      return browserSessionRecordSchema
        .array()
        .parse(
          await query(
            'SELECT created_at AS "createdAt", session_id AS "sessionId" FROM browser_sessions WHERE workspace_id = $1 ORDER BY created_at DESC',
            [scope.workspaceId]
          )
        );
    },
    async listChats(scope) {
      const rows = chatRowSchema
        .array()
        .parse(
          await query(
            'SELECT cost_usd AS "costUsd", created_at AS "createdAt", input_tokens AS "inputTokens", output_tokens AS "outputTokens", session_id AS "sessionId", title, updated_at AS "updatedAt" FROM chats WHERE workspace_id = $1 ORDER BY updated_at DESC',
            [scope.workspaceId]
          )
        );
      return chatListSchema.parse(
        rows.map(({ costUsd, inputTokens, outputTokens, ...chat }) => ({
          ...chat,
          usage: { costUsd, inputTokens, outputTokens },
        }))
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
    async readBrowserSession(scope, sessionId) {
      const rows = await query(
        'SELECT created_at AS "createdAt", session_id AS "sessionId" FROM browser_sessions WHERE workspace_id = $1 AND session_id = $2 LIMIT 1',
        [scope.workspaceId, sessionId]
      );
      return browserSessionRecordSchema.optional().parse(rows[0]);
    },
    async readEncryptedSecret(scope, id) {
      const rows = await query(
        "SELECT encrypted_value AS \"encryptedValue\" FROM encrypted_secrets WHERE workspace_id = $1 AND namespace = 'vault' AND id = $2",
        [scope.workspaceId, id]
      );
      return z.object({ encryptedValue: z.string() }).optional().parse(rows[0])
        ?.encryptedValue;
    },
    async readGatewayModel(scope) {
      const rows = await query(
        "SELECT value FROM settings WHERE workspace_id = $1 AND key = 'gateway_model' LIMIT 1",
        [scope.workspaceId]
      );
      return z.object({ value: z.string() }).optional().parse(rows[0])?.value;
    },
    async saveChat(scope, chat) {
      const now = new Date().toISOString();
      const existing = await query(
        "SELECT session_id FROM chats WHERE workspace_id = $1 AND session_id = $2",
        [scope.workspaceId, chat.sessionId]
      );
      if (existing.length === 0) {
        await query(
          "INSERT INTO chats (session_id, workspace_id, title, created_at, updated_at, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [
            chat.sessionId,
            scope.workspaceId,
            chat.title ?? "New chat",
            now,
            now,
            chat.usage?.inputTokens ?? 0,
            chat.usage?.outputTokens ?? 0,
            chat.usage?.costUsd ?? null,
          ]
        );
        return;
      }
      await query(
        "UPDATE chats SET title = COALESCE($1, title), updated_at = $2, input_tokens = COALESCE($3, input_tokens), output_tokens = COALESCE($4, output_tokens), cost_usd = CASE WHEN $5 THEN $6 ELSE cost_usd END WHERE workspace_id = $7 AND session_id = $8",
        [
          chat.title ?? null,
          now,
          chat.usage?.inputTokens ?? null,
          chat.usage?.outputTokens ?? null,
          chat.usage !== undefined,
          chat.usage?.costUsd ?? null,
          scope.workspaceId,
          chat.sessionId,
        ]
      );
    },
    async selectGatewayModel(scope, modelId) {
      await sql.query(
        "INSERT INTO settings (workspace_id, key, value) VALUES ($1, 'gateway_model', $2) ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value",
        [scope.workspaceId, modelId]
      );
    },
    async writeEncryptedSecret(scope, id, encryptedValue) {
      await query(
        "INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value, updated_at) VALUES ($1, 'vault', $2, $3, $4) ON CONFLICT (workspace_id, namespace, id) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = EXCLUDED.updated_at",
        [scope.workspaceId, id, encryptedValue, new Date().toISOString()]
      );
    },
  };
}

async function initializePostgres(sql: NeonQueryFunction<false, false>) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS workspace_memberships (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, account TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS settings (workspace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (workspace_id, key))`,
    `CREATE TABLE IF NOT EXISTS agent_sessions (session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS browser_sessions (session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS chats (session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION)`,
    `CREATE TABLE IF NOT EXISTS encrypted_secrets (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, id TEXT NOT NULL, encrypted_value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (workspace_id, namespace, id))`,
    `CREATE INDEX IF NOT EXISTS vault_items_workspace_updated_idx ON vault_items (workspace_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS chats_workspace_updated_idx ON chats (workspace_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx ON agent_sessions (workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS browser_sessions_workspace_idx ON browser_sessions (workspace_id, created_at DESC)`,
  ];
  for (const statement of statements) await sql.query(statement);
}

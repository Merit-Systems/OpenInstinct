import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("application database migration", () => {
  it("creates a validated schema and is idempotent on an empty database", async () => {
    const database = createDatabase();

    await applyMigrations(database, { repeatInitial: true });

    const tables = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'workspaces',
           'workspace_memberships',
           'vault_items',
           'settings',
           'agent_sessions',
           'browser_sessions',
           'chats',
           'encrypted_secrets',
           'feedback'
         )`
    );
    const pendingConstraints = await pendingConstraintCount(database);

    expect(tables.rows[0]?.count).toBe(9);
    expect(pendingConstraints).toBe(0);
  });

  it("preserves legacy rows while enforcing constraints for new writes", async () => {
    const database = createDatabase();
    await database.exec(legacyRuntimeSchema);
    await database.exec(`
      INSERT INTO vault_items
      VALUES (
        'legacy-item',
        'orphan-workspace',
        'legacy-kind',
        'Legacy',
        '',
        '2026-01-01',
        '2026-01-01'
      );
      INSERT INTO chats (
        session_id,
        workspace_id,
        title,
        created_at,
        updated_at
      ) VALUES (
        'legacy-chat',
        'orphan-workspace',
        'Legacy',
        '2026-01-01',
        '2026-01-01'
      );
    `);

    await applyMigrations(database);

    const vault = await database.query<{ id: string; kind: string }>(
      "SELECT id, kind FROM vault_items WHERE id = 'legacy-item'"
    );
    const chat = await database.query<{
      costUsd: number | null;
      inputTokens: number;
      outputTokens: number;
    }>(`SELECT
      cost_usd AS "costUsd",
      input_tokens AS "inputTokens",
      output_tokens AS "outputTokens"
    FROM chats
    WHERE session_id = 'legacy-chat'`);

    expect(vault.rows).toEqual([{ id: "legacy-item", kind: "legacy-kind" }]);
    expect(chat.rows).toEqual([
      { costUsd: null, inputTokens: 0, outputTokens: 0 },
    ]);
    expect(await pendingConstraintCount(database)).toBe(14);
    await expect(
      database.exec(`
        INSERT INTO vault_items
        VALUES (
          'new-invalid',
          'orphan-workspace',
          'legacy-kind',
          'Invalid',
          '',
          '2026-01-01',
          '2026-01-01'
        )
      `)
    ).rejects.toThrow(/constraint/);
  });
});

function createDatabase() {
  const database = new PGlite();
  databases.push(database);
  return database;
}

async function applyMigrations(
  database: PGlite,
  { repeatInitial = false }: { repeatInitial?: boolean } = {}
) {
  const directory = new URL("../db/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const [index, migration] of migrations.entries()) {
    const sql = await readFile(new URL(migration, directory), "utf8");
    if (repeatInitial && index === 0) await executeMigration(database, sql);
    await executeMigration(database, sql);
  }
}

async function executeMigration(database: PGlite, migration: string) {
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

async function pendingConstraintCount(database: PGlite) {
  const result = await database.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pg_constraint
     WHERE NOT convalidated
       AND connamespace = 'public'::regnamespace`
  );
  return result.rows[0]?.count;
}

const legacyRuntimeSchema = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE workspace_memberships (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE TABLE vault_items (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    account TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (workspace_id, key)
  );
  CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE browser_sessions (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE chats (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE encrypted_secrets (
    workspace_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    id TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, namespace, id)
  );
`;

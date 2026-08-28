import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  account,
  agentSessions,
  authSchema,
  browserSessions,
  chats,
  encryptedSecrets,
  session,
  settings,
  user,
  vaultItems,
  verification,
  workspaceMemberships,
  workspaces,
} from "../lib/db/schema";

const tables = [
  account,
  agentSessions,
  browserSessions,
  chats,
  encryptedSecrets,
  session,
  settings,
  user,
  vaultItems,
  verification,
  workspaceMemberships,
  workspaces,
];

describe("Drizzle database schema", () => {
  it("owns every application and Better Auth table", () => {
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual([
      "account",
      "agent_sessions",
      "browser_sessions",
      "chats",
      "encrypted_secrets",
      "session",
      "settings",
      "user",
      "vault_items",
      "verification",
      "workspace_memberships",
      "workspaces",
    ]);
    expect(authSchema).toEqual({ account, session, user, verification });
  });

  it("preserves the existing physical column names", () => {
    expect(getTableConfig(user).columns.map((column) => column.name)).toContain(
      "phoneNumberVerified"
    );
    expect(
      getTableConfig(vaultItems).columns.map((column) => column.name)
    ).toContain("workspace_id");
  });

  it("baselines databases that already have the legacy tables", () => {
    const migration = readFileSync("drizzle/0000_baseline.sql", "utf8");
    for (const table of tables) {
      expect(migration).toContain(
        `CREATE TABLE IF NOT EXISTS "${getTableConfig(table).name}"`
      );
    }
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
  });
});

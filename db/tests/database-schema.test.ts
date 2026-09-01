import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  account,
  agentSessions,
  browserImageArtifacts,
  browserSessions,
  browserTraceDomains,
  browserTraceEvents,
  browserTraces,
  chats,
  encryptedSecrets,
  session,
  settings,
  user,
  vaultItems,
  verification,
  workspaceMemberships,
  workspaces,
} from "../schema";

describe("database schema", () => {
  it("owns the application and Better Auth tables", () => {
    expect(
      [
        workspaces,
        workspaceMemberships,
        vaultItems,
        settings,
        agentSessions,
        browserImageArtifacts,
        browserSessions,
        browserTraces,
        browserTraceDomains,
        browserTraceEvents,
        chats,
        encryptedSecrets,
        user,
        session,
        account,
        verification,
      ].map((table) => getTableConfig(table).name)
    ).toEqual([
      "workspaces",
      "workspace_memberships",
      "vault_items",
      "settings",
      "agent_sessions",
      "browser_image_artifacts",
      "browser_sessions",
      "browser_traces",
      "browser_trace_domains",
      "browser_trace_events",
      "chats",
      "encrypted_secrets",
      "user",
      "session",
      "account",
      "verification",
    ]);
  });

  it("anchors session creators to a membership in the same workspace", () => {
    for (const table of [
      agentSessions,
      browserImageArtifacts,
      browserSessions,
      browserTraces,
    ]) {
      const foreignKeys = getTableConfig(table).foreignKeys;
      expect(foreignKeys.map((foreignKey) => foreignKey.getName())).toContain(
        `${getTableConfig(table).name}_membership_fkey`
      );
      const membership = foreignKeys.find((foreignKey) =>
        foreignKey.getName().endsWith("_membership_fkey")
      );
      const reference = membership?.reference();
      expect(reference?.columns.map((column) => column.name)).toEqual([
        "workspace_id",
        "created_by_user_id",
      ]);
      expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
        "workspace_id",
        "user_id",
      ]);
    }
  });

  it("keeps every workspace-owned table connected to the workspace root", () => {
    for (const table of [
      workspaceMemberships,
      vaultItems,
      settings,
      chats,
      encryptedSecrets,
    ]) {
      expect(
        getTableConfig(table).foreignKeys.some((foreignKey) =>
          foreignKey.getName().endsWith("_workspace_id_fkey")
        )
      ).toBe(true);
    }
  });
});

describe("migration deployment policy", () => {
  it("orchestrates the native migration through Turbo", async () => {
    const packageManifest = z
      .object({
        devDependencies: z.record(z.string(), z.string()),
        scripts: z.object({
          "db:check": z.string(),
          "db:generate": z.string(),
          "build:vercel": z.string(),
          "db:migrate": z.string(),
        }),
      })
      .parse(
        JSON.parse(
          await readFile(new URL("../../package.json", import.meta.url), "utf8")
        )
      );
    const turbo = z
      .object({
        tasks: z.object({
          "build:vercel": z.object({ dependsOn: z.array(z.string()) }),
          "db:migrate": z.object({
            cache: z.boolean(),
            env: z.array(z.string()),
          }),
        }),
      })
      .parse(
        JSON.parse(
          await readFile(new URL("../../turbo.json", import.meta.url), "utf8")
        )
      );
    const vercel = z
      .object({ buildCommand: z.string() })
      .parse(
        JSON.parse(
          await readFile(new URL("../../vercel.json", import.meta.url), "utf8")
        )
      );

    expect(packageManifest.scripts["build:vercel"]).toBe("next build");
    expect(packageManifest.scripts["db:check"]).toBe(
      "drizzle-kit check --config db/drizzle.config.ts"
    );
    expect(packageManifest.scripts["db:generate"]).toBe(
      "drizzle-kit generate --config db/drizzle.config.ts"
    );
    expect(packageManifest.scripts["db:migrate"]).toBe(
      "drizzle-kit migrate --config db/drizzle.config.ts"
    );
    expect(packageManifest.devDependencies).toHaveProperty("@next/env");
    expect(packageManifest.devDependencies).not.toHaveProperty("dotenv-cli");
    expect(turbo.tasks["build:vercel"].dependsOn).toContain("db:migrate");
    expect(turbo.tasks["db:migrate"].cache).toBe(false);
    expect(turbo.tasks["db:migrate"].env).toEqual(["DATABASE_URL_UNPOOLED"]);
    expect(vercel.buildCommand).toBe("pnpm turbo run build:vercel");
  });

  it("adopts existing tables without request-time DDL", async () => {
    const migration = await readFile(
      new URL("../migrations/0000_fluffy_the_spike.sql", import.meta.url),
      "utf8"
    );
    const services = await Promise.all(
      [
        "browser-traces",
        "browsers",
        "chats",
        "scope",
        "secrets",
        "sessions",
        "settings",
        "vault",
      ].map(
        async (name) =>
          await readFile(
            new URL(`../services/${name}.ts`, import.meta.url),
            "utf8"
          )
      )
    );
    const authSource = await readFile(
      new URL("../../src/auth/index.ts", import.meta.url),
      "utf8"
    );
    const authMigration = await readFile(
      new URL("../migrations/0001_better-auth.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "workspaces"');
    expect(migration).toContain(
      'ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "input_tokens"'
    );
    expect(migration).toContain(
      "ON DELETE cascade ON UPDATE no action NOT VALID"
    );
    expect(services.join("\n")).not.toContain("CREATE TABLE");
    expect(services.join("\n")).not.toContain("initializePostgres");
    expect(authMigration).toContain('CREATE TABLE IF NOT EXISTS "user"');
    expect(authMigration).toContain(
      'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumber"'
    );
    expect(authSource).toContain("database: drizzleAdapter(db");
    expect(authSource).not.toContain("getMigrations");
    expect(authSource).not.toContain("ensureAuthDatabase");
  });
});

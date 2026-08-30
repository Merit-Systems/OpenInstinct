/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double used by the service suite. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import { accessScopeForUser } from "@/lib/access-scope";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.doUnmock("@/auth/session");
  vi.doUnmock("next/headers");
  vi.resetModules();
  vi.stubEnv("WORKSPACE_SCOPE_ENFORCEMENT", "off");
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace scope verification", () => {
  it("enforces bootstrap admission and revoked membership denial at the request entrypoint", async () => {
    vi.stubEnv("WORKSPACE_SCOPE_ENFORCEMENT", "enforce");
    const scope = accessScopeForUser("better-auth:user-a");
    const service = await requestScopeService();

    await expect(service.requireRequestScope()).resolves.toMatchObject({
      membershipStatus: "active",
      role: "owner",
      ...scope,
    });

    await service.database.exec(`
      INSERT INTO workspaces (id, created_at, lifecycle_state)
      VALUES ('${scope.workspaceId}', '2026-01-01', 'active');
      INSERT INTO workspace_memberships (workspace_id, user_id, role, status, created_at)
      VALUES ('${scope.workspaceId}', '${scope.userId}', 'owner', 'revoked', '2026-01-01');
    `);
    vi.resetModules();

    const denied = await import("@/lib/request-scope");
    await expect(denied.requireRequestScope()).rejects.toBeInstanceOf(
      denied.UnauthenticatedError
    );
  });

  it("allows a deterministic first-run scope when its workspace is absent", async () => {
    const { verifyScopeAccess } = await scopeService();

    await expect(
      verifyScopeAccess({ userId: "user-a", workspaceId: "workspace-a" })
    ).resolves.toEqual({
      membershipStatus: "active",
      role: "owner",
      userId: "user-a",
      workspaceId: "workspace-a",
    });
  });

  it("denies a user whose scope targets another tenant workspace", async () => {
    const { database, verifyScopeAccess } = await scopeService();
    await database.exec(`
      INSERT INTO workspaces (id, created_at) VALUES ('workspace-b', '2026-01-01');
      INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
      VALUES ('workspace-b', 'user-b', 'owner', '2026-01-01');
    `);

    await expect(
      verifyScopeAccess({ userId: "user-a", workspaceId: "workspace-b" })
    ).resolves.toBeUndefined();
  });

  it("does not create an owner membership for an existing workspace", async () => {
    const { database, ensureScope, verifyScopeAccess } = await scopeService();
    await database.exec(`
      INSERT INTO workspaces (id, created_at) VALUES ('shared-w', '2026-01-01');
      INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
      VALUES ('shared-w', 'owner', 'owner', '2026-01-01');
    `);

    await ensureScope({ userId: "intruder", workspaceId: "shared-w" });

    await expect(
      database.query(`
        SELECT count(*)::int AS count FROM workspace_memberships
        WHERE workspace_id = 'shared-w' AND user_id = 'intruder'
      `)
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      verifyScopeAccess({ userId: "intruder", workspaceId: "shared-w" })
    ).resolves.toBeUndefined();
  });

  it.each([
    ["revoked membership", "active", "revoked"],
    ["suspended workspace", "suspended", "active"],
    ["pending deletion workspace", "pending_deletion", "active"],
  ] as const)("denies a %s", async (_label, lifecycleState, status) => {
    const { database, verifyScopeAccess } = await scopeService();
    await database.exec(`
      INSERT INTO workspaces (id, created_at, lifecycle_state)
      VALUES ('workspace-a', '2026-01-01', '${lifecycleState}');
      INSERT INTO workspace_memberships (workspace_id, user_id, role, status, created_at)
      VALUES ('workspace-a', 'user-a', 'owner', '${status}', '2026-01-01');
    `);

    await expect(
      verifyScopeAccess({ userId: "user-a", workspaceId: "workspace-a" })
    ).resolves.toBeUndefined();
  });

  it("returns the active membership role for an allowed scope", async () => {
    const { database, verifyScopeAccess } = await scopeService();
    await database.exec(`
      INSERT INTO workspaces (id, created_at, lifecycle_state)
      VALUES ('workspace-a', '2026-01-01', 'active');
      INSERT INTO workspace_memberships (workspace_id, user_id, role, status, created_at)
      VALUES ('workspace-a', 'user-a', 'owner', 'active', '2026-01-01');
    `);

    await expect(
      verifyScopeAccess({ userId: "user-a", workspaceId: "workspace-a" })
    ).resolves.toEqual({
      membershipStatus: "active",
      role: "owner",
      userId: "user-a",
      workspaceId: "workspace-a",
    });
  });
});

async function scopeService() {
  const client = new PGlite();
  databases.push(client);
  await applyMigrations(client);
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  const { ensureScope, verifyScopeAccess } =
    await import("@/db/services/scope");
  return { database: client, ensureScope, verifyScopeAccess };
}

async function requestScopeService() {
  const client = new PGlite();
  databases.push(client);
  await applyMigrations(client);
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
  vi.doMock("@/auth/session", () => ({
    getAuthSession: async () => ({ user: { id: "user-a" } }),
  }));
  const { requireRequestScope } = await import("@/lib/request-scope");
  return { database: client, requireRequestScope };
}

async function applyMigrations(database: PGlite) {
  for (const name of [
    "0000_fluffy_the_spike.sql",
    "0003_unusual_fabian_cortez.sql",
    "0004_wide_mysterio.sql",
  ]) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

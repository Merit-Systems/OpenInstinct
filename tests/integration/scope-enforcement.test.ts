import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetDatabaseForIntegrationTest,
  setDatabaseForIntegrationTest,
} from "@/db";
import { createRequireRequestScope } from "@/lib/request-scope";
import { accessScopeForUser } from "@/lib/access-scope";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  resetDatabaseForIntegrationTest();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace scope verification", () => {
  it("enforces bootstrap admission and revoked membership denial at the request entrypoint", async () => {
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
    await expect(service.createRequestScope()).rejects.toBeInstanceOf(
      service.UnauthenticatedError
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
  const database = drizzle(client, { schema });
  setDatabaseForIntegrationTest(database);
  const { ensureScope, verifyScopeAccess } =
    await import("@/db/services/scope");
  return { database: client, ensureScope, verifyScopeAccess };
}

async function requestScopeService() {
  const client = new PGlite();
  databases.push(client);
  await applyMigrations(client);
  const database = drizzle(client, { schema });
  setDatabaseForIntegrationTest(database);
  const { UnauthenticatedError } = await import("@/lib/request-scope");
  const { verifyScopeAccess } = await import("@/db/services/scope");
  const createRequestScope = () =>
    createRequireRequestScope({
      getAuthSession: async () => ({
        user: {
          id: "user-a",
          phoneNumber: "+12025550123",
          phoneNumberVerified: true as const,
        },
      }),
      headers: async () => new Headers(),
      isWorkspaceScopeEnforcementEnabled: () => true,
      verifyScopeAccess,
    })();
  return {
    database: client,
    createRequestScope,
    requireRequestScope: createRequestScope,
    UnauthenticatedError,
  };
}

async function applyMigrations(database: PGlite) {
  for (const migrationName of [
    "0000_fluffy_the_spike.sql",
    "0003_unusual_fabian_cortez.sql",
    "0004_wide_mysterio.sql",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migration files must execute in committed order.
    const migration = await readFile(
      new URL(`../../db/migrations/${migrationName}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Migration statements must execute in committed order.
        await database.exec(statement);
      }
    }
  }
}

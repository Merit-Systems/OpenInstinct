import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace tenancy migration", () => {
  it("backfills a legacy workspace lifecycle while preserving its owner membership", async () => {
    const database = createDatabase();
    await applyExistingMigrations(database);
    await database.exec(`
      INSERT INTO workspaces (id, created_at)
      VALUES ('legacy-workspace', '2026-01-01');
      INSERT INTO workspace_memberships (
        workspace_id,
        user_id,
        role,
        created_at
      ) VALUES ('legacy-workspace', 'legacy-owner', 'owner', '2026-01-01');
    `);

    await applyTenancyMigration(database);

    const migratedWorkspace = await database.query<{
      lifecycleState: string;
      updatedAt: string;
    }>(`
      SELECT
        lifecycle_state AS "lifecycleState",
        updated_at AS "updatedAt"
      FROM workspaces
      WHERE id = 'legacy-workspace'
    `);
    expect(migratedWorkspace.rows).toHaveLength(1);
    expect(migratedWorkspace.rows[0]?.lifecycleState).toBe("active");
    expect(migratedWorkspace.rows[0]?.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T.*Z$/
    );
    await expect(
      database.query(`
        SELECT count(*)::int AS count
        FROM workspace_memberships
        WHERE workspace_id = 'legacy-workspace' AND role = 'owner'
      `)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("applies tenant defaults and rejects invalid lifecycle and role values", async () => {
    const database = createDatabase();
    await applyAllMigrations(database);
    await database.exec(`
      INSERT INTO workspaces (id, created_at)
      VALUES ('defaults-workspace', '2026-01-01');
    `);

    await expect(
      database.query(`
        SELECT
          display_name AS "displayName",
          plan,
          lifecycle_state AS "lifecycleState",
          policy_version AS "policyVersion"
        FROM workspaces
        WHERE id = 'defaults-workspace'
      `)
    ).resolves.toMatchObject({
      rows: [
        {
          displayName: null,
          lifecycleState: "active",
          plan: "free",
          policyVersion: 1,
        },
      ],
    });
    await database.exec(`
      INSERT INTO workspace_memberships (
        workspace_id,
        user_id,
        role,
        created_at
      ) VALUES ('defaults-workspace', 'default-member', 'owner', '2026-01-01');
      INSERT INTO workspace_memberships (
        workspace_id,
        user_id,
        role,
        status,
        created_at
      ) VALUES
        ('defaults-workspace', 'admin-member', 'admin', 'invited', '2026-01-01'),
        ('defaults-workspace', 'standard-member', 'member', 'revoked', '2026-01-01');
    `);
    await expect(
      database.query(`
        SELECT
          status,
          invited_by_user_id AS "invitedByUserId",
          invited_at AS "invitedAt"
        FROM workspace_memberships
        WHERE workspace_id = 'defaults-workspace' AND user_id = 'default-member'
      `)
    ).resolves.toMatchObject({
      rows: [{ invitedAt: null, invitedByUserId: null, status: "active" }],
    });
    await expect(
      database.exec(`
        INSERT INTO workspaces (id, created_at, lifecycle_state)
        VALUES ('invalid-lifecycle', '2026-01-01', 'invalid')
      `)
    ).rejects.toThrow(/constraint/);
    await expect(
      database.exec(`
        INSERT INTO workspace_memberships (
          workspace_id,
          user_id,
          role,
          created_at
        ) VALUES ('defaults-workspace', 'invalid-role', 'invalid', '2026-01-01')
      `)
    ).rejects.toThrow(/constraint/);
    await expect(
      database.exec(`
        INSERT INTO workspace_memberships (
          workspace_id,
          user_id,
          role,
          status,
          created_at
        ) VALUES ('defaults-workspace', 'invalid-status', 'member', 'bogus', '2026-01-01')
      `)
    ).rejects.toThrow(/constraint/);
  });

  it("widens an unvalidated legacy role check without validating legacy rows", async () => {
    const database = createDatabase();
    await applyExistingMigrations(database);
    await database.exec(`
      INSERT INTO workspaces (id, created_at)
      VALUES ('legacy-roles', '2026-01-01');
      ALTER TABLE workspace_memberships
      DROP CONSTRAINT workspace_memberships_role_check;
      INSERT INTO workspace_memberships (
        workspace_id,
        user_id,
        role,
        created_at
      ) VALUES ('legacy-roles', 'legacy-invalid', 'legacy-role', '2026-01-01');
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.workspace_memberships'::regclass
            AND conname = 'workspace_memberships_role_check'
        ) THEN
          ALTER TABLE workspace_memberships
          ADD CONSTRAINT workspace_memberships_role_check
          CHECK (role = 'owner') NOT VALID;
        END IF;
      END
      $$;
    `);

    await expect(applyTenancyMigration(database)).resolves.toBeUndefined();
    const roleConstraint = await database.query<{
      definition: string;
      validated: boolean;
    }>(`
      SELECT
        convalidated AS validated,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.workspace_memberships'::regclass
        AND conname = 'workspace_memberships_role_check'
    `);
    expect(roleConstraint.rows).toHaveLength(1);
    expect(roleConstraint.rows[0]).toMatchObject({ validated: false });
    expect(roleConstraint.rows[0]?.definition).toContain("'owner'::text");
    expect(roleConstraint.rows[0]?.definition).toContain("'admin'::text");
    expect(roleConstraint.rows[0]?.definition).toContain("'member'::text");
    await expect(
      database.exec(`
        INSERT INTO workspace_memberships (
          workspace_id,
          user_id,
          role,
          created_at
        ) VALUES ('legacy-roles', 'legacy-admin', 'admin', '2026-01-01')
      `)
    ).resolves.toBeDefined();
    await expect(
      database.exec(`
        INSERT INTO workspace_memberships (
          workspace_id,
          user_id,
          role,
          created_at
        ) VALUES ('legacy-roles', 'legacy-member', 'member', '2026-01-01')
      `)
    ).resolves.toBeDefined();
  });

  it("keeps membership queries scoped to the selected workspace", async () => {
    const database = createDatabase();
    await applyAllMigrations(database);
    await database.exec(`
      INSERT INTO workspaces (id, created_at)
      VALUES ('workspace-a', '2026-01-01'), ('workspace-b', '2026-01-01');
      INSERT INTO workspace_memberships (
        workspace_id,
        user_id,
        role,
        created_at
      ) VALUES
        ('workspace-a', 'member-a', 'owner', '2026-01-01'),
        ('workspace-b', 'member-b', 'owner', '2026-01-01');
    `);

    await expect(
      database.query(`
        SELECT user_id AS "userId"
        FROM workspace_memberships
        WHERE workspace_id = 'workspace-a'
        ORDER BY user_id
      `)
    ).resolves.toMatchObject({ rows: [{ userId: "member-a" }] });
  });
});

function createDatabase() {
  const database = new PGlite();
  databases.push(database);
  return database;
}

async function applyExistingMigrations(database: PGlite) {
  for (const name of await migrationNames()) {
    if (name !== (await tenancyMigrationName()))
      await applyMigration(database, name);
  }
}

async function applyAllMigrations(database: PGlite) {
  for (const name of await migrationNames())
    await applyMigration(database, name);
}

async function applyTenancyMigration(database: PGlite) {
  await applyMigration(database, await tenancyMigrationName());
}

async function migrationNames() {
  return (await readdir(new URL("../db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function tenancyMigrationName() {
  for (const name of await migrationNames()) {
    const migration = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    if (migration.includes('"lifecycle_state"')) return name;
  }
  throw new Error("Expected a committed workspace tenancy migration.");
}

async function applyMigration(database: PGlite, name: string) {
  const migration = await readFile(
    new URL(`../db/migrations/${name}`, import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

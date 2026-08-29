/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import * as schema from "../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/env");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("API credentials", () => {
  it("mints a one-time secret, stores only its hash, audits, and requires an owner", async () => {
    const service = await loadService();
    const minted = await service.credentials.mintApiCredential(service.alice, {
      name: "CI",
      scopes: ["agents:read"],
    });
    expect(minted.secret).toMatch(/^oi_[A-Za-z0-9_-]{43}$/);
    expect(minted.credential.keyPrefix).toBe(minted.secret.slice(0, 11));
    expect(minted.credential).not.toHaveProperty("keyHash");
    await expect(
      service.client.query("SELECT key_hash FROM api_credentials")
    ).resolves.not.toMatchObject({ rows: [{ key_hash: minted.secret }] });
    await expect(
      service.credentials.mintApiCredential(service.member, {
        name: "No",
        scopes: ["agents:read"],
      })
    ).rejects.toThrow("Only workspace owners can manage API credentials.");
    await expect(
      service.client.query("SELECT action FROM audit_events")
    ).resolves.toMatchObject({ rows: [{ action: "api_credential.mint" }] });
  });

  it("authenticates valid credentials and isolates wrong, revoked, expired, and other-tenant keys", async () => {
    const service = await loadService();
    const alice = await service.credentials.mintApiCredential(service.alice, {
      name: "A",
      scopes: ["agents:read"],
    });
    const bob = await service.credentials.mintApiCredential(service.bob, {
      name: "B",
      scopes: ["usage:read"],
    });
    expect(
      await service.credentials.authenticateApiKey(alice.secret)
    ).toMatchObject({
      workspaceId: service.alice.workspaceId,
      scopes: ["agents:read"],
    });
    expect(
      await service.credentials.authenticateApiKey("oi_wrong")
    ).toBeUndefined();
    expect(
      await service.credentials.authenticateApiKey(bob.secret)
    ).toMatchObject({ workspaceId: service.bob.workspaceId });
    await service.credentials.revokeApiCredential(
      service.alice,
      alice.credential.id
    );
    expect(
      await service.credentials.authenticateApiKey(alice.secret)
    ).toBeUndefined();
    const expired = await service.credentials.mintApiCredential(service.alice, {
      name: "old",
      scopes: ["agents:read"],
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(
      await service.credentials.authenticateApiKey(expired.secret)
    ).toBeUndefined();
  });

  it("lists only for active owners and never returns hashes; cross-tenant revocation is inert", async () => {
    const service = await loadService();
    const minted = await service.credentials.mintApiCredential(service.alice, {
      name: "A",
      scopes: ["agents:read"],
    });
    expect(
      await service.credentials.listApiCredentials(service.member)
    ).toEqual([]);
    const listed = await service.credentials.listApiCredentials(service.alice);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("keyHash");
    expect(
      await service.credentials.revokeApiCredential(
        service.bob,
        minted.credential.id
      )
    ).toBe(false);
    expect(
      await service.credentials.authenticateApiKey(minted.secret)
    ).toBeDefined();
  });
});

async function loadService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/env", () => ({
    isWorkspaceScopeEnforcementEnabled: () => false,
  }));
  const credentials = await import("@/db/services/api-credentials");
  const scope = await import("@/db/services/scope");
  const alice = { userId: "alice", workspaceId: "workspace:alice" };
  const bob = { userId: "bob", workspaceId: "workspace:bob" };
  const member = { userId: "member", workspaceId: "workspace:alice" };
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  await client.exec(
    "INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ('workspace:alice', 'member', 'member', '2026-01-01')"
  );
  return { alice, bob, client, credentials, member };
}

async function applyAllMigrations(database: PGlite) {
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint"))
      if (statement.trim()) await database.exec(statement);
  }
}

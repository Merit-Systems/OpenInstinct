import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import { accessScopeForUser } from "@/lib/access-scope";
import * as schema from "../db/schema";

const databases: PGlite[] = [];
const key = {
  authorizationSubject: "subject:alice",
  connectorId: "google/test",
  provider: "google" as const,
};

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("connection installations", () => {
  it("records idempotently and refreshes the timestamp without duplicates", async () => {
    const service = await loadService();
    const first = await service.installations.recordConnectionInstallation(
      service.alice,
      key
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await service.installations.recordConnectionInstallation(
      service.alice,
      { ...key, scopes: ["email"] }
    );

    expect(second.id).toBe(first.id);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    await expect(
      service.client.query("SELECT id FROM connection_installations")
    ).resolves.toMatchObject({ rows: [{ id: first.id }] });
  });

  it("does not reactivate a revoked installation when re-recorded", async () => {
    const service = await loadService();
    await service.installations.recordConnectionInstallation(
      service.alice,
      key
    );
    await service.installations.revokeConnectionInstallation(
      service.alice,
      key
    );

    await expect(
      service.installations.recordConnectionInstallation(service.alice, key)
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("does not expose an installation to another tenant", async () => {
    const service = await loadService();
    await service.installations.recordConnectionInstallation(
      service.alice,
      key
    );

    await expect(
      service.installations.findConnectionInstallation(service.bob, key)
    ).resolves.toBeUndefined();
    await service.installations.revokeConnectionInstallation(
      service.alice,
      key
    );
    await expect(
      service.installations.findConnectionInstallation(service.alice, key)
    ).resolves.toMatchObject({ status: "revoked" });
  });

  it("revokes only the installation owned by the scoped tenant", async () => {
    const service = await loadService();
    await service.installations.recordConnectionInstallation(
      service.alice,
      key
    );

    await expect(
      service.installations.revokeConnectionInstallation(service.bob, key)
    ).resolves.toBe(false);
    await expect(
      service.installations.revokeConnectionInstallation(service.alice, key)
    ).resolves.toBe(true);
    const installation = await service.installations.findConnectionInstallation(
      service.alice,
      key
    );
    expect(installation?.status).toBe("revoked");
    expect(typeof installation?.revokedAt).toBe("string");
  });

  it("allows a reconnect to replace a revoked installation with an active row", async () => {
    const service = await loadService();
    await service.installations.recordConnectionInstallation(
      service.alice,
      key
    );
    await service.installations.revokeConnectionInstallation(
      service.alice,
      key
    );
    await service.installations.deleteRevokedConnectionInstallation(
      service.alice,
      key
    );

    await expect(
      service.installations.recordConnectionInstallation(service.alice, key)
    ).resolves.toMatchObject({ status: "active" });
  });
});

async function loadService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  const installations = await import("@/db/services/connection-installations");
  const scope = await import("@/db/services/scope");
  const alice = accessScopeForUser("better-auth:alice");
  const bob = accessScopeForUser("better-auth:bob");
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  return { alice, bob, client, installations };
}

async function applyAllMigrations(database: PGlite) {
  const names = (await readdir(new URL("../db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const migration = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

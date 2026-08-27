import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";
import { createAppStore } from "../lib/server/app-store";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("application store", () => {
  it("preserves workspace ownership and update behavior through Drizzle", async () => {
    const client = new PGlite();
    databases.push(client);
    await applyInitialMigration(client);

    const database = drizzle(client, { schema });
    Object.assign(database, {
      batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
        await Promise.all(queries.map(async (query) => await query.execute())),
    });
    // The store uses Neon HTTP's Drizzle adapter in production. PGlite exposes
    // the same PostgreSQL query builders; this test supplies Neon's batch hook.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
    const store = await createAppStore(database as unknown as Database);
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };

    await store.ensureScope(alice);
    await store.ensureScope(bob);
    await store.claimSession(alice, "session-alice");

    expect(await store.isSessionOwned(alice, "session-alice")).toBe(true);
    expect(await store.isSessionOwned(bob, "session-alice")).toBe(false);
    expect(await store.listOwnedSessionIds(alice)).toEqual(
      new Set(["session-alice"])
    );
    expect(await store.listOwnedSessionIds(bob)).toEqual(new Set());

    await store.saveChat(alice, {
      sessionId: "session-alice",
      title: "Initial title",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
    await store.saveChat(alice, {
      sessionId: "session-alice",
      title: "Updated title",
    });

    const aliceChats = await store.listChats(alice);
    expect(aliceChats).toHaveLength(1);
    expect(aliceChats[0]?.sessionId).toBe("session-alice");
    expect(aliceChats[0]?.title).toBe("Updated title");
    expect(aliceChats[0]?.usage).toEqual({
      costUsd: 0.25,
      inputTokens: 10,
      outputTokens: 4,
    });
    expect(aliceChats[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(aliceChats[0]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.listChats(bob)).toEqual([]);

    await store.writeEncryptedSecret(alice, "shared-id", "ciphertext-alice");
    await store.writeEncryptedSecret(bob, "shared-id", "ciphertext-bob");

    expect(await store.readEncryptedSecret(alice, "shared-id")).toBe(
      "ciphertext-alice"
    );
    expect(await store.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );
    await store.deleteEncryptedSecret(alice, "shared-id");
    expect(await store.readEncryptedSecret(alice, "shared-id")).toBeUndefined();
    expect(await store.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );
  }, 15_000);
});

async function applyInitialMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../db/migrations/0000_fluffy_the_spike.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

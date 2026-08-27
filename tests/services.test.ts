import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("database services", () => {
  it("preserves workspace ownership across application domains", async () => {
    const client = new PGlite();
    databases.push(client);
    await applyMigrations(client);

    const pgliteDatabase = drizzle(client, { schema });
    Object.assign(pgliteDatabase, {
      batch: async (queries: readonly { execute(): Promise<unknown> }[]) =>
        await Promise.all(queries.map(async (query) => await query.execute())),
    });
    // Production uses Neon's Drizzle adapter. PGlite exposes compatible
    // PostgreSQL query builders and this test supplies Neon's batch hook.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
    const database = pgliteDatabase as unknown as Database;
    vi.doMock("@/db", () => ({ ...schema, db: database }));

    const [
      browsers,
      chats,
      feedback,
      secrets,
      sessions,
      settings,
      scope,
      vault,
    ] = await Promise.all([
      import("@/db/services/browsers"),
      import("@/db/services/chats"),
      import("@/db/services/feedback"),
      import("@/db/services/secrets"),
      import("@/db/services/sessions"),
      import("@/db/services/settings"),
      import("@/db/services/scope"),
      import("@/db/services/vault"),
    ]);
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };

    await scope.ensureScope(alice);
    await scope.ensureScope(bob);
    await sessions.claimSession(alice, "session-alice");

    expect(await sessions.isSessionOwned(alice, "session-alice")).toBe(true);
    expect(await sessions.isSessionOwned(bob, "session-alice")).toBe(false);
    expect(await sessions.listOwnedSessionIds(alice)).toEqual(
      new Set(["session-alice"])
    );
    expect(await sessions.listOwnedSessionIds(bob)).toEqual(new Set());

    await sessions.claimSession(bob, "session-alice");
    expect(await sessions.isSessionOwned(alice, "session-alice")).toBe(true);
    expect(await sessions.isSessionOwned(bob, "session-alice")).toBe(false);

    const feedbackSubmission = {
      category: "bug" as const,
      feedback: "the browser timed out",
      idempotencyKey: "give-feedback:session-alice:turn-1:digest",
      sessionId: "session-alice",
      toolCallId: "call-1",
      turnId: "turn-1",
    };
    const firstFeedback = await feedback.saveFeedback(
      alice,
      feedbackSubmission
    );
    const replayedFeedback = await feedback.saveFeedback(
      alice,
      feedbackSubmission
    );

    expect(replayedFeedback.id).toBe(firstFeedback.id);
    expect(firstFeedback).toMatchObject({
      category: "bug",
      feedback: "the browser timed out",
      status: "new",
    });
    await expect(
      feedback.saveFeedback(bob, feedbackSubmission)
    ).rejects.toThrow(/scope does not match/iu);
    const persistedFeedback = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM feedback"
    );
    expect(persistedFeedback.rows[0]?.count).toBe(1);

    await chats.saveChat(alice, {
      sessionId: "session-alice",
      title: "Initial title",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
    await chats.saveChat(alice, {
      sessionId: "session-alice",
      title: "Updated title",
    });

    const aliceChat = await chats.readChat(alice, "session-alice");
    expect(aliceChat?.title).toBe("Updated title");
    expect(aliceChat?.usage).toEqual({
      costUsd: 0.25,
      inputTokens: 10,
      outputTokens: 4,
    });
    expect(await chats.readChat(bob, "session-alice")).toBeUndefined();
    expect(await chats.listChats(alice)).toEqual([aliceChat]);
    expect(await chats.listChats(bob)).toEqual([]);

    await expect(
      chats.saveChat(bob, {
        sessionId: "session-alice",
        title: "Bob's title",
      })
    ).rejects.toThrow(/Failed query: insert into "chats"/);
    expect(await chats.readChat(alice, "session-alice")).toEqual(aliceChat);
    expect(await chats.readChat(bob, "session-alice")).toBeUndefined();

    await browsers.createBrowserSession(alice, {
      createdAt: new Date().toISOString(),
      sessionId: "browser-alice",
    });
    expect(
      await browsers.readBrowserSession(alice, "browser-alice")
    ).toBeDefined();
    expect(
      await browsers.readBrowserSession(bob, "browser-alice")
    ).toBeUndefined();
    expect(await browsers.listBrowserSessions(alice)).toHaveLength(1);
    expect(await browsers.deleteBrowserSession(bob, "browser-alice")).toBe(
      false
    );

    const now = new Date().toISOString();
    await vault.createVaultItem(alice, {
      account: "alice@example.com",
      createdAt: now,
      id: "vault-alice",
      kind: "login",
      label: "Alice",
      updatedAt: now,
    });
    expect(await vault.readVaultItem(alice, "vault-alice")).toMatchObject({
      id: "vault-alice",
    });
    expect(await vault.readVaultItem(bob, "vault-alice")).toBeUndefined();
    expect(await vault.listVaultItems(alice)).toHaveLength(1);
    expect(await vault.deleteVaultItem(bob, "vault-alice")).toBe(false);

    await secrets.writeEncryptedSecret(alice, "shared-id", "ciphertext-alice");
    await secrets.writeEncryptedSecret(bob, "shared-id", "ciphertext-bob");
    expect(await secrets.readEncryptedSecret(alice, "shared-id")).toBe(
      "ciphertext-alice"
    );
    expect(await secrets.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );
    await secrets.deleteEncryptedSecret(alice, "shared-id");
    expect(
      await secrets.readEncryptedSecret(alice, "shared-id")
    ).toBeUndefined();
    expect(await secrets.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );

    await settings.selectGatewayModel(alice, "openai/test");
    expect(await settings.readGatewayModel(alice)).toBe("openai/test");
    expect(await settings.readGatewayModel(bob)).toBeUndefined();
  }, 15_000);
});

async function applyMigrations(database: PGlite) {
  const directory = new URL("../db/migrations/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

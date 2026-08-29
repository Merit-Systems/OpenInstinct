import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import { accessScopeForUser } from "@/lib/access-scope";
import * as schema from "../db/schema";

const databases: PGlite[] = [];
const manifest = {
  capabilities: ["calendar.read"],
  instructions: "Be helpful.",
  modelPolicy: { tier: "standard" },
  version: 1,
};
const bindingInput = {
  phoneIdentityId: "identity-alice",
  platformLine: { providerLineId: "+12025550123" },
  provider: "linq" as const,
  providerAccountId: "linq/test",
  providerConversationId: "linq:chat-1:dm",
  userId: "alice",
};

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("channel conversation bindings", () => {
  it("resolves known active bindings and ignores unknown bindings", async () => {
    const service = await loadService();
    await service.createActiveAgent();
    const created =
      await service.conversations.createConversationBinding(bindingInput);
    if (!created) throw new Error("Expected a binding.");

    await expect(
      service.conversations.resolveConversationBinding({
        provider: "linq",
        providerAccountId: "linq/test",
        providerConversationId: "missing",
      })
    ).resolves.toBeUndefined();
    await expect(
      service.conversations.resolveConversationBinding({
        provider: "linq",
        providerAccountId: "linq/test",
        providerConversationId: "linq:chat-1:dm",
      })
    ).resolves.toMatchObject({
      id: created.id,
      pinnedRevisionId: created.pinnedRevisionId,
      workspaceId: service.alice.workspaceId,
    });
  });

  it("creates an owner participant pinned to the sole active agent revision", async () => {
    const service = await loadService();
    const { agent, revision } = await service.createActiveAgent();

    const binding =
      await service.conversations.createConversationBinding(bindingInput);

    expect(binding).toMatchObject({
      agentId: agent.id,
      pinnedRevisionId: revision.id,
      workspaceId: service.alice.workspaceId,
    });
    await expect(
      service.client.query(`SELECT role, status FROM channel_participants`)
    ).resolves.toMatchObject({ rows: [{ role: "owner", status: "active" }] });
  });

  it("fails closed when the workspace has zero or multiple active agents", async () => {
    const service = await loadService();
    await expect(
      service.conversations.createConversationBinding(bindingInput)
    ).resolves.toBeUndefined();

    await service.createActiveAgent("first");
    await service.createActiveAgent("second");
    await expect(
      service.conversations.createConversationBinding(bindingInput)
    ).resolves.toBeUndefined();
  });

  it("returns the same binding and participant for duplicate creation", async () => {
    const service = await loadService();
    await service.createActiveAgent();
    const first =
      await service.conversations.createConversationBinding(bindingInput);
    const second =
      await service.conversations.createConversationBinding(bindingInput);

    expect(second?.id).toBe(first?.id);
    await expect(
      service.client.query(`SELECT id FROM channel_participants`)
    ).resolves.toMatchObject({ rows: [expect.any(Object)] });
  });

  it("does not attach a participant when another workspace owns the provider triple", async () => {
    const service = await loadService();
    await service.createActiveAgent();
    await service.createBobActiveAgent();
    const foreign = await service.conversations.createConversationBinding({
      ...bindingInput,
      phoneIdentityId: "identity-bob",
      userId: "bob",
    });
    if (!foreign) throw new Error("Expected the foreign binding.");

    await expect(
      service.conversations.createConversationBinding(bindingInput)
    ).resolves.toBeUndefined();
    await expect(
      service.client.query(
        `SELECT phone_identity_id FROM channel_participants ORDER BY phone_identity_id`
      )
    ).resolves.toMatchObject({ rows: [{ phone_identity_id: "identity-bob" }] });
  });

  it("does not resolve or recreate a closed binding", async () => {
    const service = await loadService();
    await service.createActiveAgent();
    const binding =
      await service.conversations.createConversationBinding(bindingInput);
    if (!binding) throw new Error("Expected a binding.");
    await service.client.exec(`
      UPDATE channel_conversations SET status = 'closed' WHERE id = '${binding.id}';
    `);

    await expect(
      service.conversations.resolveConversationBinding({
        provider: bindingInput.provider,
        providerAccountId: bindingInput.providerAccountId,
        providerConversationId: bindingInput.providerConversationId,
      })
    ).resolves.toBeUndefined();
    await expect(
      service.conversations.createConversationBinding(bindingInput)
    ).resolves.toBeUndefined();
  });

  it("does not use another workspace's active agent", async () => {
    const service = await loadService();
    await service.createBobActiveAgent();

    await expect(
      service.conversations.createConversationBinding(bindingInput)
    ).resolves.toBeUndefined();
  });

  it("requires a verified phone identity owned by the calling user", async () => {
    const service = await loadService();
    await service.createActiveAgent();

    await expect(
      service.conversations.createConversationBinding({
        ...bindingInput,
        phoneIdentityId: "identity-bob",
      })
    ).resolves.toBeUndefined();
    await expect(
      service.conversations.createConversationBinding({
        ...bindingInput,
        phoneIdentityId: "identity-revoked",
      })
    ).resolves.toBeUndefined();
  });

  it("lets the composite foreign key reject a cross-workspace revision", async () => {
    const service = await loadService();
    const { agent } = await service.createActiveAgent();
    const { revision: bobRevision } = await service.createBobActiveAgent();
    await service.client.exec(`
      INSERT INTO platform_lines (id, provider, provider_line_id)
      VALUES ('line-1', 'linq', '+12025550123');
    `);

    await expect(
      service.client.exec(`
        INSERT INTO channel_conversations (
          id, provider, provider_account_id, provider_conversation_id,
          platform_line_id, workspace_id, agent_id, pinned_revision_id
        ) VALUES (
          'cross-workspace', 'linq', 'linq/test', 'chat-cross', 'line-1',
          '${service.alice.workspaceId}', '${agent.id}', '${bobRevision.id}'
        );
      `)
    ).rejects.toThrow(/foreign key/i);
  });
});

async function loadService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  await client.exec(`
    INSERT INTO "user" (id, name, email) VALUES
      ('alice', 'Alice', 'alice@example.test'),
      ('bob', 'Bob', 'bob@example.test');
    INSERT INTO phone_identities (
      id, user_id, encrypted_phone_number, phone_lookup_hash, verified_at
    ) VALUES
      ('identity-alice', 'alice', 'v1.test.test.test', 'alice-phone', '2026-01-01T00:00:00.000Z'),
      ('identity-bob', 'bob', 'v1.test.test.test', 'bob-phone', '2026-01-01T00:00:00.000Z'),
      ('identity-revoked', 'alice', 'v1.test.test.test', 'revoked-phone', '2026-01-01T00:00:00.000Z');
    UPDATE phone_identities SET status = 'revoked' WHERE id = 'identity-revoked';
  `);
  const pgliteDatabase = drizzle(client, { schema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  const agents = await import("@/db/services/agents");
  const conversations = await import("@/db/services/channel-conversations");
  const scope = await import("@/db/services/scope");
  const alice = accessScopeForUser("better-auth:alice");
  const bob = accessScopeForUser("better-auth:bob");
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  return {
    alice,
    client,
    conversations,
    async createActiveAgent(slug = "assistant") {
      const agent = await agents.createAgent(alice, { slug });
      const revision = await agents.createRevision(alice, agent.id, manifest);
      await agents.publishRevision(alice, agent.id, revision.id);
      return { agent, revision };
    },
    async createBobActiveAgent() {
      const agent = await agents.createAgent(bob, { slug: "bob-assistant" });
      const revision = await agents.createRevision(bob, agent.id, manifest);
      await agents.publishRevision(bob, agent.id, revision.id);
      return { agent, revision };
    },
  };
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

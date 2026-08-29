/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double. */
import { createHmac } from "node:crypto";
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

describe("webhook outbox", () => {
  it("registers only public HTTPS endpoints, encrypts the one-time secret, and requires an owner", async () => {
    const service = await loadService();
    for (const url of [
      "http://example.test",
      "https://10.0.0.1",
      "https://127.0.0.1",
      "https://localhost",
      "https://169.254.169.254",
      "https://192.168.1.1",
      "https://0.0.0.0",
    ]) {
      await expect(
        service.webhooks.registerWebhookEndpoint(service.alice, {
          url,
          subscribedEvents: ["agent.published"],
        })
      ).rejects.toThrow(/public HTTPS/i);
    }
    const registered = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      {
        url: "https://hooks.example.test/path",
        subscribedEvents: ["agent.published"],
      }
    );
    expect(registered.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(
      service.webhooks.encryptWebhookSecretForTest("iv-test", "same-secret")
    ).not.toBe(
      service.webhooks.encryptWebhookSecretForTest("iv-test", "same-secret")
    );
    const [stored] = (
      await service.client.query<{
        id: string;
        encrypted_signing_secret: string;
      }>("SELECT id, encrypted_signing_secret FROM webhook_endpoints")
    ).rows;
    if (!stored) throw new Error("Expected a stored endpoint.");
    expect(stored.encrypted_signing_secret).not.toContain(registered.secret);
    expect(
      service.webhooks.decryptWebhookSecretForTest(
        stored.id,
        stored.encrypted_signing_secret
      )
    ).toBe(registered.secret);
    expect(() =>
      service.webhooks.decryptWebhookSecretForTest(
        "wrong",
        stored.encrypted_signing_secret
      )
    ).toThrow("Unsupported");
    await expect(
      service.webhooks.registerWebhookEndpoint(service.member, {
        url: "https://no.example.test",
        subscribedEvents: ["agent.published"],
      })
    ).rejects.toThrow(/owners/i);
  });

  it("emits only to active subscribed endpoints atomically and keeps tenants isolated", async () => {
    const service = await loadService();
    const subscribed = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      { url: "https://a.example.test", subscribedEvents: ["agent.published"] }
    );
    await service.webhooks.registerWebhookEndpoint(service.alice, {
      url: "https://other.example.test",
      subscribedEvents: ["agent.rolled_back"],
    });
    const disabled = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      {
        url: "https://disabled.example.test",
        subscribedEvents: ["agent.published"],
      }
    );
    await service.webhooks.disableWebhookEndpoint(
      service.alice,
      disabled.endpoint.id
    );
    await service.webhooks.registerWebhookEndpoint(service.bob, {
      url: "https://b.example.test",
      subscribedEvents: ["agent.published"],
    });
    await service.database.transaction(async (transaction) => {
      await service.webhooks.emitWebhookEvent(transaction, service.alice, {
        type: "agent.published",
        payload: { agentId: "a", revisionId: "r" },
      });
    });
    expect(
      (await service.client.query("SELECT endpoint_id FROM webhook_deliveries"))
        .rows
    ).toEqual([]);
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => new Response("", { status: 500 }),
    });
    expect(
      (await service.client.query("SELECT endpoint_id FROM webhook_deliveries"))
        .rows
    ).toEqual([{ endpoint_id: subscribed.endpoint.id }]);
    await expect(
      service.database.transaction(async (transaction) => {
        await service.webhooks.emitWebhookEvent(transaction, service.alice, {
          type: "agent.published",
          payload: { agentId: "no", revisionId: "no" },
        });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    expect(
      (
        await service.client.query(
          "SELECT count(*)::int AS count FROM webhook_events"
        )
      ).rows
    ).toEqual([{ count: 1 }]);
  });

  it("signs and retries deliveries, and makes terminal client errors dead", async () => {
    const service = await loadService();
    const registered = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      {
        url: "https://hooks.example.test",
        subscribedEvents: ["agent.published"],
      }
    );
    await service.webhooks.emitWebhookEvent(service.database, service.alice, {
      type: "agent.published",
      payload: { agentId: "a", revisionId: "r" },
    });
    let url = "";
    let init: RequestInit | undefined;
    const delivered = await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async (input, requestInit) => {
        url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        init = requestInit;
        return { status: 204 } as Response;
      },
    });
    expect(delivered).toMatchObject({ delivered: 1 });
    expect(url).toBe("https://hooks.example.test/");
    if (!init) throw new Error("Expected delivery request init.");
    const body = init.body as string;
    const headers = new Headers(init.headers);
    const timestamp = headers.get("x-oi-timestamp");
    if (!timestamp) throw new Error("Expected delivery timestamp.");
    expect(headers.get("x-oi-signature")).toBe(
      `v1=${createHmac("sha256", registered.secret).update(`${timestamp}.${body}`).digest("hex")}`
    );
    await service.client.exec(
      "UPDATE webhook_deliveries SET outcome = 'pending', attempt = 0, next_attempt_at = '2000-01-01T00:00:00.000Z'"
    );
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => new Response("", { status: 500 }),
    });
    expect(
      (
        await service.client.query(
          "SELECT outcome, attempt FROM webhook_deliveries"
        )
      ).rows
    ).toEqual([{ outcome: "failed", attempt: 1 }]);
    await service.client.exec(
      "UPDATE webhook_deliveries SET outcome = 'pending', attempt = 0, next_attempt_at = '2000-01-01T00:00:00.000Z'"
    );
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => new Response("", { status: 404 }),
    });
    expect(
      (await service.client.query("SELECT outcome FROM webhook_deliveries"))
        .rows
    ).toEqual([{ outcome: "dead" }]);
  });

  it("publishing a revision appends an event before the delivery worker fans out", async () => {
    const service = await loadService();
    await service.webhooks.registerWebhookEndpoint(service.alice, {
      url: "https://published.example.test",
      subscribedEvents: ["agent.published"],
    });
    const agent = await service.agents.createAgent(service.alice, {
      slug: "publisher",
    });
    const revision = await service.agents.createRevision(
      service.alice,
      agent.id,
      {
        capabilities: [],
        instructions: "Publish me.",
        modelPolicy: { tier: "standard" },
        version: 1,
      }
    );
    await service.agents.publishRevision(service.alice, agent.id, revision.id);
    expect(
      (await service.client.query("SELECT type, payload FROM webhook_events"))
        .rows
    ).toEqual([
      {
        type: "agent.published",
        payload: { agentId: agent.id, revisionId: revision.id },
      },
    ]);
    expect(
      (
        await service.client.query(
          "SELECT count(*)::int AS count FROM webhook_deliveries"
        )
      ).rows
    ).toEqual([{ count: 0 }]);
  });

  it("scopes owner operations and disables already-pending deliveries", async () => {
    const service = await loadService();
    const registered = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      {
        url: "https://disable.example.test",
        subscribedEvents: ["agent.published"],
      }
    );
    expect(await service.webhooks.listWebhookEndpoints(service.bob)).toEqual(
      []
    );
    expect(
      await service.webhooks.disableWebhookEndpoint(
        service.bob,
        registered.endpoint.id
      )
    ).toBe(false);
    expect(
      await service.webhooks.rotateWebhookSecret(
        service.bob,
        registered.endpoint.id
      )
    ).toBeUndefined();
    await service.webhooks.emitWebhookEvent(service.database, service.alice, {
      type: "agent.published",
      payload: { agentId: "a", revisionId: "r" },
    });
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => new Response("", { status: 500 }),
    });
    await service.webhooks.disableWebhookEndpoint(
      service.alice,
      registered.endpoint.id
    );
    expect(
      (await service.client.query("SELECT outcome FROM webhook_deliveries"))
        .rows
    ).toEqual([{ outcome: "dead" }]);
    expect(
      await service.webhooks.rotateWebhookSecret(
        service.alice,
        registered.endpoint.id
      )
    ).toBeUndefined();
  });

  it("does not follow redirects, rechecks SSRF, and caps retries", async () => {
    const service = await loadService();
    const registered = await service.webhooks.registerWebhookEndpoint(
      service.alice,
      {
        url: "https://delivery.example.test",
        subscribedEvents: ["agent.published"],
      }
    );
    await service.webhooks.emitWebhookEvent(service.database, service.alice, {
      type: "agent.published",
      payload: { agentId: "a", revisionId: "r" },
    });
    let fetches = 0;
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => {
        fetches += 1;
        return new Response("", { status: 302 });
      },
    });
    expect(fetches).toBe(1);
    expect(
      (await service.client.query("SELECT outcome FROM webhook_deliveries"))
        .rows
    ).toEqual([{ outcome: "dead" }]);
    await service.client.exec(
      `UPDATE webhook_endpoints SET url = 'https://127.0.0.1' WHERE id = '${registered.endpoint.id}'; UPDATE webhook_deliveries SET outcome = 'pending', attempt = 0, next_attempt_at = '2000-01-01T00:00:00.000Z';`
    );
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => {
        throw new Error("private URL must not be fetched");
      },
    });
    expect(
      (await service.client.query("SELECT outcome FROM webhook_deliveries"))
        .rows
    ).toEqual([{ outcome: "dead" }]);
    await service.client.exec(
      "UPDATE webhook_endpoints SET url = 'https://delivery.example.test'; UPDATE webhook_deliveries SET outcome = 'pending', attempt = 6, next_attempt_at = '2000-01-01T00:00:00.000Z'"
    );
    await service.webhooks.drainWebhookDeliveries({
      fetchImpl: async () => {
        throw new Error("attempt cap must not fetch");
      },
    });
    expect(
      (await service.client.query("SELECT outcome FROM webhook_deliveries"))
        .rows
    ).toEqual([{ outcome: "dead" }]);
  });

  it("keeps publishing available when endpoint storage is unavailable", async () => {
    const service = await loadService();
    await service.client.exec("DROP TABLE webhook_endpoints CASCADE");
    const agent = await service.agents.createAgent(service.alice, {
      slug: "outbox-only",
    });
    const revision = await service.agents.createRevision(
      service.alice,
      agent.id,
      {
        capabilities: [],
        instructions: "Durable.",
        modelPolicy: { tier: "standard" },
        version: 1,
      }
    );
    await expect(
      service.agents.publishRevision(service.alice, agent.id, revision.id)
    ).resolves.toBeDefined();
    expect(
      (await service.client.query("SELECT type FROM webhook_events")).rows
    ).toEqual([{ type: "agent.published" }]);
  });
});

async function loadService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/env", () => ({
    env: { SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
    isWorkspaceScopeEnforcementEnabled: () => false,
  }));
  const webhooks = await import("@/db/services/webhooks");
  const agents = await import("@/db/services/agents");
  const scope = await import("@/db/services/scope");
  const alice = { userId: "alice", workspaceId: "workspace:alice" };
  const bob = { userId: "bob", workspaceId: "workspace:bob" };
  const member = { userId: "member", workspaceId: "workspace:alice" };
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  await client.exec(
    "INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at) VALUES ('workspace:alice', 'member', 'member', '2026-01-01')"
  );
  return { agents, alice, bob, client, database, member, webhooks };
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
    for (const statement of migration.split("--> statement-breakpoint"))
      if (statement.trim()) await database.exec(statement);
  }
}

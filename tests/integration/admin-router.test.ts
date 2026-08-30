/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double used by the service suite. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { TRPCError } from "@trpc/server";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import type { AccessScope } from "@/lib/access-scope";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];
const mocks = vi.hoisted(() => {
  class AdminNotFoundError extends Error {}
  return {
    AdminNotFoundError,
    requireAdminScopeFor: vi.fn<(scope: AccessScope) => Promise<AccessScope>>(),
  };
});

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/admin");
  vi.resetModules();
  vi.clearAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("admin router", () => {
  it("is invisible when the admin gate denies the caller", async () => {
    const service = await loadRouter(false);
    await expect(service.caller.admin.overview()).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<TRPCError>);
  });

  it("returns aggregate projections without encrypted or phone fields", async () => {
    const service = await loadRouter(true);
    await seed(service.client);

    const result = await service.caller.admin.overview();

    expect(result).toMatchObject({
      activeApiCredentials: 1,
      activeChannelConversations: 1,
      agentsByStatus: { active: 1 },
      usageByKind: { model_tokens: 12 },
      verifiedPhoneIdentities: 1,
      webhookDeliveryOutcomes: { pending: 1 },
      workspacesByLifecycle: { active: 2 },
    });
    const payload = JSON.stringify([
      result,
      await service.caller.admin.usage({}),
      await service.caller.admin.auditLog({}),
      await service.caller.admin.webhookDeliveries({}),
      await service.caller.admin.workspaces({}),
      await service.caller.admin.sessionsActivity({}),
    ]);
    expect(payload).not.toContain("encrypted-phone");
    expect(payload).not.toContain("encrypted-webhook-secret");
    expect(payload).not.toContain("credential-key-hash");
    expect(payload).not.toContain("+12125550100");
  });

  it("paginates audit events newest first", async () => {
    const service = await loadRouter(true);
    await seed(service.client);
    await service.client.exec(`
      INSERT INTO audit_events (id, workspace_id, action, created_at) VALUES
        ('audit-2', 'workspace-a', 'second', '2026-02-02T00:00:00.000Z'),
        ('audit-3', 'workspace-a', 'third', '2026-02-03T00:00:00.000Z');
    `);

    const first = await service.caller.admin.auditLog({ limit: 2 });
    expect(first.events.map((event) => event.action)).toEqual([
      "third",
      "second",
    ]);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = await service.caller.admin.auditLog({
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second.events.map((event) => event.action)).toEqual(["seed"]);
  });

  it("records an admin audit event after draining deliveries", async () => {
    const service = await loadRouter(true);
    await seed(service.client);

    await service.caller.admin.drainWebhooks({ limit: 1 });

    await expect(
      service.client.query(
        "SELECT action, actor_user_id FROM audit_events WHERE action = 'admin.webhook_drain'"
      )
    ).resolves.toMatchObject({
      rows: [{ action: "admin.webhook_drain", actor_user_id: "admin" }],
    });
  });

  it("bootstraps an admin's absent personal workspace before auditing a drain", async () => {
    const service = await loadRouter(true);

    await expect(
      service.caller.admin.drainWebhooks({ limit: 1 })
    ).resolves.toBeDefined();
    await expect(
      service.client.query(
        "SELECT id FROM workspaces WHERE id = 'admin-workspace'"
      )
    ).resolves.toMatchObject({ rows: [{ id: "admin-workspace" }] });
    await expect(
      service.client.query(
        "SELECT workspace_id, action, actor_user_id FROM audit_events WHERE action = 'admin.webhook_drain'"
      )
    ).resolves.toMatchObject({
      rows: [
        {
          action: "admin.webhook_drain",
          actor_user_id: "admin",
          workspace_id: "admin-workspace",
        },
      ],
    });
  });
});

async function loadRouter(allowed: boolean) {
  const client = await createDatabase();
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/admin", () => ({
    AdminNotFoundError: mocks.AdminNotFoundError,
    requireAdminScopeFor: mocks.requireAdminScopeFor,
  }));
  vi.doMock("@/lib/model-catalog/server", () => ({
    readModelCatalog: () => undefined,
  }));
  vi.doMock("@/lib/task-history/server", () => ({
    readTaskHistoryPage: () => undefined,
  }));
  vi.doMock("@/db/services/chats", () => ({ saveChat: () => undefined }));
  vi.doMock("@/lib/google-workspace/server", () => ({
    disconnectGoogleWorkspace: () => undefined,
    startGoogleWorkspaceAuthorization: () => undefined,
  }));
  vi.doMock("@/lib/manager/server/store", () => ({
    applyManagerMutation: () => undefined,
  }));
  mocks.requireAdminScopeFor.mockImplementation(async (scope) => {
    if (!allowed) throw new mocks.AdminNotFoundError();
    return scope;
  });
  const { appRouter } = await import("@/trpc/router");
  const scope = { userId: "admin", workspaceId: "admin-workspace" };
  return {
    caller: appRouter.createCaller({ origin: "https://example.test", scope }),
    client,
  };
}

async function createDatabase() {
  const client = new PGlite();
  databases.push(client);
  for (const name of (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  return client;
}

async function seed(client: PGlite) {
  await client.exec(`
    INSERT INTO workspaces (id, lifecycle_state, created_at) VALUES
      ('workspace-a', 'active', '2026-01-01T00:00:00.000Z'),
      ('admin-workspace', 'active', '2026-01-01T00:00:00.000Z');
    INSERT INTO "user" (id, name, email, "phoneNumber")
      VALUES ('user-a', 'User A', 'user-a@example.test', '+12125550100');
    INSERT INTO agents (id, workspace_id, slug, status, created_at, updated_at)
      VALUES ('agent-a', 'workspace-a', 'agent-a', 'active', '2026-01-01', '2026-01-01');
    INSERT INTO phone_identities (id, user_id, encrypted_phone_number, phone_lookup_hash, verified_at)
      VALUES ('phone-a', 'user-a', 'encrypted-phone', 'lookup-a', '2026-01-01');
    INSERT INTO platform_lines (id, provider, provider_line_id)
      VALUES ('line-a', 'linq', 'line-a');
    INSERT INTO agent_revisions (id, workspace_id, agent_id, revision_number, manifest, content_digest, created_by_user_id, created_at)
      VALUES ('revision-a', 'workspace-a', 'agent-a', 1, '{}', 'digest-a', 'user-a', '2026-01-01');
    UPDATE agents SET active_revision_id = 'revision-a' WHERE id = 'agent-a';
    INSERT INTO channel_conversations (id, provider, provider_account_id, provider_conversation_id, platform_line_id, workspace_id, agent_id, pinned_revision_id)
      VALUES ('conversation-a', 'linq', 'account-a', 'conversation-a', 'line-a', 'workspace-a', 'agent-a', 'revision-a');
    INSERT INTO api_credentials (id, workspace_id, name, key_hash, key_prefix, scopes, created_by_user_id)
      VALUES ('credential-a', 'workspace-a', 'Credential', 'credential-key-hash', 'oi_live', '[]', 'user-a');
    INSERT INTO usage_events (id, workspace_id, kind, quantity, unit)
      VALUES ('usage-a', 'workspace-a', 'model_tokens', 12, 'tokens');
    INSERT INTO webhook_endpoints (id, workspace_id, url, encrypted_signing_secret, subscribed_events)
      VALUES ('endpoint-a', 'workspace-a', 'https://hooks.example.test', 'encrypted-webhook-secret', '[]');
    INSERT INTO webhook_events (id, workspace_id, type, payload)
      VALUES ('event-a', 'workspace-a', 'agent.published', '{}');
    INSERT INTO webhook_deliveries (id, workspace_id, event_id, endpoint_id, next_attempt_at)
      VALUES ('delivery-a', 'workspace-a', 'event-a', 'endpoint-a', '2999-01-01T00:00:00.000Z');
    INSERT INTO audit_events (id, workspace_id, action, created_at)
      VALUES ('audit-1', 'workspace-a', 'seed', '2026-02-01T00:00:00.000Z');
  `);
}

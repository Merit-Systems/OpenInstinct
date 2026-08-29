/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double used by the service suite. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import * as schema from "../db/schema";

const databases: PGlite[] = [];
let enforcementEnabled = false;

afterEach(async () => {
  enforcementEnabled = false;
  vi.doUnmock("@/db");
  vi.doUnmock("@/db/services/scope");
  vi.doUnmock("@/lib/env");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace lifecycle", () => {
  it("allows each lifecycle edge and audits it", async () => {
    const service = await loadService();
    for (const [from, to] of [
      ["trial", "active"],
      ["active", "suspended"],
      ["suspended", "active"],
      ["active", "pending_deletion"],
    ] as const) {
      await service.client.exec(
        `UPDATE workspaces SET lifecycle_state = '${from}' WHERE id = 'workspace-a'`
      );
      await service.lifecycle.transitionWorkspaceLifecycle(service.owner, to);
      await expect(
        service.client.query(
          "SELECT lifecycle_state FROM workspaces WHERE id = 'workspace-a'"
        )
      ).resolves.toMatchObject({ rows: [{ lifecycle_state: to }] });
    }
    await expect(
      service.client.query(
        "SELECT action, outcome FROM audit_events WHERE workspace_id = 'workspace-a' ORDER BY created_at"
      )
    ).resolves.toMatchObject({
      rows: [
        { action: "workspace.activate", outcome: "ok" },
        { action: "workspace.suspend", outcome: "ok" },
        { action: "workspace.reactivate", outcome: "ok" },
        { action: "workspace.pending_deletion", outcome: "ok" },
      ],
    });
  });

  it.each([
    ["trial", "pending_deletion"],
    ["suspended", "trial"],
    ["pending_deletion", "active"],
    ["deleted", "active"],
  ] as const)("rejects the disallowed %s -> %s edge", async (from, to) => {
    const service = await loadService();
    await service.client.exec(
      `UPDATE workspaces SET lifecycle_state = '${from}' WHERE id = 'workspace-a'`
    );
    await expect(
      service.lifecycle.transitionWorkspaceLifecycle(service.owner, to)
    ).rejects.toBeInstanceOf(
      service.lifecycle.WorkspaceLifecycleTransitionError
    );
  });

  it("reserves the terminal deleted state for deleteWorkspaceData", async () => {
    const service = await loadService();
    await expect(
      service.lifecycle.transitionWorkspaceLifecycle(service.owner, "deleted")
    ).rejects.toBeInstanceOf(
      service.lifecycle.WorkspaceLifecycleTransitionError
    );
  });

  it("requires an active owner membership in the target workspace", async () => {
    const service = await loadService();
    for (const scope of [service.admin, service.member, service.wrongTenant]) {
      await expect(
        service.lifecycle.transitionWorkspaceLifecycle(scope, "suspended")
      ).rejects.toBeInstanceOf(
        service.lifecycle.WorkspaceLifecycleAuthorizationError
      );
    }
  });

  it("denies suspended workspaces through the shared budget chokepoint and allows after reactivation", async () => {
    const service = await loadService();
    enforcementEnabled = true;
    await service.client.exec(
      "UPDATE workspaces SET lifecycle_state = 'suspended' WHERE id = 'workspace-a'"
    );
    await expect(
      service.usage.checkBudget(service.owner, "model_tokens")
    ).rejects.toBeInstanceOf(service.scope.WorkspaceNotOperableError);
    await expect(
      service.browsers.createBrowserSession(service.owner, {
        createdAt: "2026-01-01",
        sessionId: "suspended-browser",
      })
    ).rejects.toBeInstanceOf(service.scope.WorkspaceNotOperableError);
    await expect(
      service.client.query(
        "SELECT count(*)::int AS count FROM browser_sessions WHERE session_id = 'suspended-browser'"
      )
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await service.client.exec(
      "UPDATE workspaces SET lifecycle_state = 'active' WHERE id = 'workspace-a'"
    );
    await expect(
      service.usage.checkBudget(service.owner, "browser_session")
    ).resolves.toBeUndefined();
  });

  it("does not call the lifecycle guard while enforcement is off", async () => {
    const client = await createDatabase();
    const database = drizzle(client, { schema }) as unknown as typeof db;
    const assertWorkspaceOperable = vi.fn<() => void>();
    vi.doMock("@/db", () => ({ ...schema, db: database }));
    vi.doMock("@/lib/env", () => ({
      isWorkspaceScopeEnforcementEnabled: () => false,
    }));
    vi.doMock("@/db/services/scope", () => ({ assertWorkspaceOperable }));
    const usage = await import("@/db/services/usage");

    await usage.checkBudget(
      { userId: "owner", workspaceId: "workspace-a" },
      "model_tokens"
    );
    expect(assertWorkspaceOperable).not.toHaveBeenCalled();
  });

  it("deletes owned data only from a pending-deletion workspace and preserves retained records", async () => {
    const service = await loadService();
    await seedOwnedRows(service.client, "workspace-a", "owner");
    await seedOwnedRows(service.client, "workspace-b", "other-owner");
    await service.client.exec(`
      INSERT INTO webhook_endpoints (id, workspace_id, url, encrypted_signing_secret, subscribed_events)
      VALUES ('endpoint-a', 'workspace-a', 'https://deleted.example.test', 'encrypted-webhook-secret', '[]');
      INSERT INTO webhook_events (id, workspace_id, type, payload)
      VALUES ('webhook-event-a', 'workspace-a', 'agent.published', '{}');
      INSERT INTO webhook_deliveries (id, workspace_id, event_id, endpoint_id, next_attempt_at)
      VALUES ('webhook-delivery-a', 'workspace-a', 'webhook-event-a', 'endpoint-a', '2026-01-01');
    `);
    await expect(
      service.lifecycle.deleteWorkspaceData(service.owner)
    ).rejects.toBeInstanceOf(
      service.lifecycle.WorkspaceLifecycleTransitionError
    );

    await service.client.exec(
      "UPDATE workspaces SET lifecycle_state = 'pending_deletion' WHERE id = 'workspace-a'"
    );
    await expect(
      service.lifecycle.deleteWorkspaceData(service.admin)
    ).rejects.toBeInstanceOf(
      service.lifecycle.WorkspaceLifecycleAuthorizationError
    );
    const counts = await service.lifecycle.deleteWorkspaceData(service.owner);
    expect(counts).toMatchObject({
      agentRevisions: 1,
      agentSessions: 1,
      agents: 1,
      browserImageArtifacts: 1,
      browserSessions: 1,
      channelConversations: 1,
      channelParticipants: 1,
      chats: 1,
      connectionInstallations: 1,
      encryptedSecrets: 1,
      settings: 1,
      vaultItems: 1,
      webhookDeliveries: 1,
      webhookEndpoints: 1,
      webhookEvents: 1,
      workspaceBudgets: 1,
      workspaceMemberships: 3,
    });
    const [workspace, usage, audit, auditCount, deletedRows, otherTenantVault] =
      await Promise.all([
        service.client.query(
          "SELECT lifecycle_state FROM workspaces WHERE id = 'workspace-a'"
        ),
        service.client.query(
          "SELECT count(*)::int AS count FROM usage_events WHERE workspace_id = 'workspace-a'"
        ),
        service.client.query(
          "SELECT action, actor_user_id, metadata FROM audit_events WHERE workspace_id = 'workspace-a' ORDER BY created_at DESC LIMIT 1"
        ),
        service.client.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE workspace_id = 'workspace-a'"
        ),
        service.client.query<{ table_name: string; count: number }>(
          `
          SELECT 'agent_revisions' AS table_name, count(*)::int AS count FROM agent_revisions WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'agent_sessions', count(*)::int FROM agent_sessions WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'agents', count(*)::int FROM agents WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'browser_image_artifacts', count(*)::int FROM browser_image_artifacts WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'browser_sessions', count(*)::int FROM browser_sessions WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'channel_conversations', count(*)::int FROM channel_conversations WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'chats', count(*)::int FROM chats WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'connection_installations', count(*)::int FROM connection_installations WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'encrypted_secrets', count(*)::int FROM encrypted_secrets WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'settings', count(*)::int FROM settings WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'vault_items', count(*)::int FROM vault_items WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'workspace_budgets', count(*)::int FROM workspace_budgets WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'workspace_memberships', count(*)::int FROM workspace_memberships WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'channel_participants', count(*)::int FROM channel_participants WHERE conversation_id = 'conversation-a'
          UNION ALL SELECT 'webhook_deliveries', count(*)::int FROM webhook_deliveries WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'webhook_endpoints', count(*)::int FROM webhook_endpoints WHERE workspace_id = 'workspace-a'
          UNION ALL SELECT 'webhook_events', count(*)::int FROM webhook_events WHERE workspace_id = 'workspace-a'
        `
        ),
        service.client.query(
          "SELECT count(*)::int AS count FROM vault_items WHERE workspace_id = 'workspace-b'"
        ),
      ]);
    expect(workspace.rows).toEqual([{ lifecycle_state: "deleted" }]);
    expect(usage.rows).toEqual([{ count: 1 }]);
    expect(auditCount.rows).toEqual([{ count: 2 }]);
    expect(audit.rows).toMatchObject([
      {
        action: "workspace.delete",
        actor_user_id: "owner",
        metadata: {
          deletedCounts: { agents: 1 },
          externalCleanupPending: ["blob", "kernel", "provider_grants"],
          retained: ["usage_events", "audit_events"],
        },
      },
    ]);
    expect(deletedRows.rows).toHaveLength(17);
    for (const row of deletedRows.rows) expect(row.count).toBe(0);
    expect(otherTenantVault.rows).toEqual([{ count: 1 }]);
  });
});

async function loadService() {
  const client = await createDatabase();
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/env", () => ({
    isWorkspaceScopeEnforcementEnabled: () => enforcementEnabled,
  }));
  const lifecycle = await import("@/db/services/workspace-lifecycle");
  const browsers = await import("@/db/services/browsers");
  const scope = await import("@/db/services/scope");
  const usage = await import("@/db/services/usage");
  const owner = { userId: "owner", workspaceId: "workspace-a" };
  const admin = { userId: "admin", workspaceId: "workspace-a" };
  const member = { userId: "member", workspaceId: "workspace-a" };
  const wrongTenant = { userId: "owner", workspaceId: "workspace-b" };
  await scope.ensureScope(owner);
  await scope.ensureScope({
    userId: "other-owner",
    workspaceId: "workspace-b",
  });
  await client.exec(`
    INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
    VALUES ('workspace-a', 'admin', 'admin', '2026-01-01'),
      ('workspace-a', 'member', 'member', '2026-01-01');
    INSERT INTO "user" (id, name, email) VALUES
      ('owner', 'Owner', 'owner@example.test'),
      ('other-owner', 'Other owner', 'other@example.test');
  `);
  return {
    admin,
    browsers,
    client,
    lifecycle,
    member,
    owner,
    scope,
    usage,
    wrongTenant,
  };
}

async function createDatabase() {
  const client = new PGlite();
  databases.push(client);
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  return client;
}

async function seedOwnedRows(
  client: PGlite,
  workspaceId: string,
  userId: string
) {
  const id = workspaceId.slice(-1);
  await client.exec(`
    INSERT INTO agents (id, workspace_id, slug, created_at, updated_at)
    VALUES ('agent-${id}', '${workspaceId}', 'agent-${id}', '2026-01-01', '2026-01-01');
    INSERT INTO agent_revisions (
      id, workspace_id, agent_id, revision_number, manifest, content_digest,
      created_by_user_id, created_at
    ) VALUES (
      'revision-${id}', '${workspaceId}', 'agent-${id}', 1, '{}', 'digest-${id}',
      '${userId}', '2026-01-01'
    );
    UPDATE agents SET active_revision_id = 'revision-${id}' WHERE id = 'agent-${id}';
    INSERT INTO platform_lines (id, provider, provider_line_id)
    VALUES ('line-${id}', 'linq', '+12025550${id}');
    INSERT INTO phone_identities (
      id, user_id, encrypted_phone_number, phone_lookup_hash, verified_at
    ) VALUES (
      'identity-${id}', '${userId}', 'encrypted-${id}', 'lookup-${id}', '2026-01-01'
    );
    INSERT INTO channel_conversations (
      id, provider, provider_account_id, provider_conversation_id, platform_line_id,
      workspace_id, agent_id, pinned_revision_id
    ) VALUES (
      'conversation-${id}', 'linq', 'account-${id}', 'conversation-${id}', 'line-${id}',
      '${workspaceId}', 'agent-${id}', 'revision-${id}'
    );
    INSERT INTO channel_participants (id, conversation_id, phone_identity_id)
    VALUES ('participant-${id}', 'conversation-${id}', 'identity-${id}');
    INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id, created_at)
    VALUES ('agent-session-${id}', '${workspaceId}', '${userId}', '2026-01-01');
    INSERT INTO browser_sessions (session_id, workspace_id, created_by_user_id, created_at)
    VALUES ('browser-session-${id}', '${workspaceId}', '${userId}', '2026-01-01');
    INSERT INTO browser_image_artifacts (
      id, workspace_id, created_by_user_id, root_session_id, worker_session_id,
      browser_session_id, status, label, storage_pathname, source_kind, idempotency_key, created_at
    ) VALUES (
      'image-${id}', '${workspaceId}', '${userId}', 'root-${id}', 'worker-${id}',
      'browser-session-${id}', 'pending', 'Image', 'blob/${id}', 'viewport', 'key-${id}', '2026-01-01'
    );
    INSERT INTO chats (session_id, workspace_id, title, created_at, updated_at)
    VALUES ('chat-${id}', '${workspaceId}', 'Chat', '2026-01-01', '2026-01-01');
    INSERT INTO vault_items (id, workspace_id, kind, label, account, created_at, updated_at)
    VALUES ('vault-${id}', '${workspaceId}', 'token', 'Token', 'Account', '2026-01-01', '2026-01-01');
    INSERT INTO encrypted_secrets (workspace_id, namespace, id, encrypted_value, updated_at)
    VALUES ('${workspaceId}', 'vault', 'secret-${id}', 'encrypted', '2026-01-01');
    INSERT INTO settings (workspace_id, key, value) VALUES ('${workspaceId}', 'gateway_model', 'model');
    INSERT INTO connection_installations (id, workspace_id, provider, connector_id, authorization_subject)
    VALUES ('installation-${id}', '${workspaceId}', 'linq', 'connector-${id}', 'subject-${id}');
    INSERT INTO workspace_budgets (workspace_id, model_token_limit) VALUES ('${workspaceId}', 10);
    INSERT INTO usage_events (id, workspace_id, kind, quantity, unit)
    VALUES ('usage-${id}', '${workspaceId}', 'model_tokens', 1, 'tokens');
    INSERT INTO audit_events (id, workspace_id, action) VALUES ('audit-${id}', '${workspaceId}', 'seed');
  `);
}

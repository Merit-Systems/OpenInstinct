import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];
let enforcementEnabled = false;

afterEach(async () => {
  enforcementEnabled = false;
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/env");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("usage and audit services", () => {
  it("appends tenant-scoped usage and audit events", async () => {
    const service = await loadServices();
    await service.chats.saveChat(service.alice, {
      sessionId: "chat-1",
      usage: { costUsd: 0.25, inputTokens: 8, outputTokens: 4 },
    });
    await service.browsers.createBrowserSession(service.alice, {
      createdAt: new Date().toISOString(),
      sessionId: "browser-1",
      workerSessionId: "worker-browser-1",
    });
    await service.usage.recordUsageEvent(service.alice, {
      kind: "model_tokens",
      quantity: 12,
      unit: "tokens",
    });
    await service.usage.recordUsageEvent(service.bob, {
      kind: "model_tokens",
      quantity: 99,
      unit: "tokens",
    });
    await service.usage.recordUsageEvent(service.alice, {
      kind: "browser_session",
      quantity: 1,
      unit: "sessions",
    });
    expect(
      await service.usage.sumUsageSince(
        service.alice,
        "model_tokens",
        "2000-01-01T00:00:00.000Z"
      )
    ).toBe(12);
    await service.audit.recordAuditEvent(service.alice, {
      action: "agent.publish",
      target: "agent-1",
    });
    await expect(
      service.client.query(
        "SELECT workspace_id, action FROM audit_events ORDER BY created_at"
      )
    ).resolves.toMatchObject({
      rows: [{ action: "agent.publish", workspace_id: "workspace:alice" }],
    });
  });

  it("does not ledger cumulative web-chat saves because step.completed is the token producer", async () => {
    const service = await loadServices();
    for (const tokens of [100, 250, 400]) {
      await service.chats.saveChat(service.alice, {
        sessionId: "chat-cumulative",
        usage: { costUsd: 1, inputTokens: tokens, outputTokens: 0 },
      });
    }
    await service.chats.saveChat(service.alice, {
      sessionId: "chat-cumulative",
      usage: { costUsd: 1, inputTokens: 400, outputTokens: 0 },
    });
    expect(
      await service.usage.sumUsageSince(
        service.alice,
        "model_tokens",
        "2000-01-01T00:00:00.000Z"
      )
    ).toBe(0);
  });

  it("enforces configured monthly budgets and excludes prior-month events", async () => {
    const service = await loadServices();
    enforcementEnabled = true;
    await service.usage.checkBudget(service.alice, "model_tokens");
    await service.client.query(
      "INSERT INTO workspace_budgets (workspace_id, model_token_limit) VALUES ('workspace:alice', 10)"
    );
    await service.usage.recordUsageEvent(service.alice, {
      createdAt: "2000-01-01T00:00:00.000Z",
      kind: "model_tokens",
      quantity: 100,
      unit: "tokens",
    });
    await service.usage.checkBudget(service.alice, "model_tokens");
    await service.usage.recordUsageEvent(service.alice, {
      kind: "model_tokens",
      quantity: 10,
      unit: "tokens",
    });
    await expect(
      service.usage.checkBudget(service.alice, "model_tokens")
    ).rejects.toBeInstanceOf(service.usage.BudgetExceededError);
    await expect(
      service.client.query(
        "SELECT outcome, metadata FROM audit_events WHERE workspace_id = 'workspace:alice'"
      )
    ).resolves.toMatchObject({
      rows: [{ metadata: { kind: "model_tokens" }, outcome: "denied" }],
    });
  });

  it("allows when the flag is off or budget storage is unavailable", async () => {
    const service = await loadServices();
    await service.client.query("DROP TABLE workspace_budgets");
    await expect(
      service.usage.checkBudget(service.alice, "model_tokens")
    ).resolves.toBeUndefined();
    enforcementEnabled = true;
    await expect(
      service.usage.checkBudget(service.alice, "model_tokens")
    ).resolves.toBeUndefined();
  });

  it("keeps chat and browser writes successful when the usage ledger is unavailable", async () => {
    const service = await loadServices();
    await service.client.query("DROP TABLE usage_events");
    await expect(
      service.chats.saveChat(service.alice, {
        sessionId: "chat-no-ledger",
        usage: { costUsd: 1, inputTokens: 1, outputTokens: 1 },
      })
    ).resolves.toBeUndefined();
    await expect(
      service.browsers.createBrowserSession(service.alice, {
        createdAt: new Date().toISOString(),
        sessionId: "browser-no-ledger",
        workerSessionId: "worker-browser-no-ledger",
      })
    ).resolves.toBeUndefined();
  });
});

async function loadServices() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const pgliteDatabase = drizzle(client, { schema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite is adapter-compatible.
  const database = pgliteDatabase as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/env", () => ({
    isWorkspaceScopeEnforcementEnabled: () => enforcementEnabled,
  }));
  const scope = await import("@/db/services/scope");
  const usage = await import("@/db/services/usage");
  const audit = await import("@/db/services/audit");
  const chats = await import("@/db/services/chats");
  const browsers = await import("@/db/services/browsers");
  const alice = { userId: "alice", workspaceId: "workspace:alice" };
  const bob = { userId: "bob", workspaceId: "workspace:bob" };
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  return { alice, audit, bob, browsers, chats, client, usage };
}

async function applyAllMigrations(database: PGlite) {
  const names = (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

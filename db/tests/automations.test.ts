import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@/db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("automation service", () => {
  it("isolates owners and deduplicates saved automations and runs", async () => {
    const client = new PGlite();
    databases.push(client);
    await applyMigration(client, "0000_fluffy_the_spike.sql");
    await applyMigration(client, "0006_chilly_the_leader.sql");
    await applyMigration(client, "0007_freezing_silver_sable.sql");
    const database = drizzle(client, { schema });
    // SAFETY: PGlite implements the Drizzle query surface used by this service test.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared schema and query contract.
    const testDatabase = database as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(testDatabase);

    const [automations, scopeService, sessions] = await Promise.all([
      import("@/db/services/automations"),
      import("@/db/services/scope"),
      import("@/db/services/sessions"),
    ]);
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };
    await scopeService.ensureScope(alice);
    await scopeService.ensureScope(bob);
    await sessions.claimSession(alice, "session-alice");

    const runAt = new Date(Date.now() + 50).toISOString();
    const input = {
      idempotencyKey: "session-alice:call-1",
      phoneNumber: "+12125550123",
      sessionId: "session-alice",
      task: "Check the L train and summarize it.",
      timezone: "America/New_York",
      title: "L train status",
      trigger: { at: runAt, kind: "at" } as const,
    };
    const created = await automations.createAutomation(alice, input);
    const retried = await automations.createAutomation(alice, input);
    expect(retried.id).toBe(created.id);
    expect(await automations.listAutomations(bob)).toEqual([]);

    const firstRun = await automations.beginAutomationRun(
      created.id,
      created.revision,
      `timer:${runAt}`
    );
    expect(firstRun?.automation.id).toBe(created.id);
    await expect(
      automations.beginAutomationRun(
        created.id,
        created.revision,
        `timer:${runAt}`
      )
    ).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const completed = await automations.finishAutomationRun({
      result: "No L train delays.",
      runId: firstRun?.runId ?? "missing",
    });
    expect(completed.status).toBe("completed");
    expect(completed.nextRunAt).toBeNull();

    const recurring = await automations.createAutomation(alice, {
      ...input,
      idempotencyKey: "session-alice:call-2",
      trigger: { everyMinutes: 5, kind: "interval" },
    });
    if (!recurring.nextRunAt)
      throw new Error("Expected the next interval run.");
    const recurringRun = await automations.beginAutomationRun(
      recurring.id,
      recurring.revision,
      `timer:${recurring.nextRunAt}`
    );
    const paused = await automations.setAutomationStatus(
      alice,
      recurring.id,
      "paused"
    );
    await automations.finishAutomationRun({
      result: "Finished after the pause.",
      runId: recurringRun?.runId ?? "missing",
    });
    const preservedRecurring = (await automations.listAutomations(alice)).find(
      (automation) => automation.id === recurring.id
    );
    expect(paused?.status).toBe("paused");
    expect(preservedRecurring).toMatchObject({
      nextRunAt: null,
      revision: 2,
      status: "paused",
    });
  }, 15_000);

  it("arms one shared Gmail watch per connected user", async () => {
    const client = new PGlite();
    databases.push(client);
    await applyMigration(client, "0000_fluffy_the_spike.sql");
    await applyMigration(client, "0006_chilly_the_leader.sql");
    await applyMigration(client, "0007_freezing_silver_sable.sql");
    const database = drizzle(client, { schema });
    // SAFETY: PGlite implements the Drizzle query surface used by this service test.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared schema and query contract.
    const testDatabase = database as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(testDatabase);
    const [automations, scopeService] = await Promise.all([
      import("@/db/services/automations"),
      import("@/db/services/scope"),
    ]);
    const scope = { userId: "alice", workspaceId: "workspace:alice" };
    await scopeService.ensureScope(scope);

    const prepared = await automations.prepareGmailWatch(scope);
    expect(prepared).toEqual({ generation: 1, startRequired: true });
    await automations.activateGmailWatch({
      emailAddress: "alice@example.com",
      expirationAt: new Date(
        Date.now() + 6 * 24 * 60 * 60 * 1000
      ).toISOString(),
      generation: prepared.generation,
      historyId: "12345",
      scope,
    });
    await expect(automations.prepareGmailWatch(scope)).resolves.toEqual({
      generation: 1,
      startRequired: false,
    });
    await automations.activateGmailWatch({
      emailAddress: "alice@example.com",
      expirationAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      generation: prepared.generation,
      historyId: "12345",
      scope,
    });
    const renewal = await automations.prepareGmailWatch(scope);
    expect(renewal).toEqual({ generation: 2, startRequired: true });
    expect(
      await automations.readGmailWatchByEmail("alice@example.com")
    ).toMatchObject({ historyId: "12345", status: "active" });
    await automations.activateGmailWatch({
      emailAddress: "alice@example.com",
      expirationAt: new Date(
        Date.now() + 6 * 24 * 60 * 60 * 1000
      ).toISOString(),
      generation: renewal.generation,
      historyId: "99999",
      scope,
    });
    expect(
      await automations.readGmailWatchByEmail("alice@example.com")
    ).toMatchObject({ historyId: "12345", status: "active" });
  }, 15_000);
});

async function applyMigration(database: PGlite, name: string) {
  const migration = await readFile(
    new URL(`../migrations/${name}`, import.meta.url),
    "utf8"
  );
  /* oxlint-disable eslint/no-await-in-loop -- SQL migration statements must execute in file order. */
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  /* oxlint-enable eslint/no-await-in-loop */
}

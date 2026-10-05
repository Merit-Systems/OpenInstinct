/* oxlint-disable eslint/no-await-in-loop -- Apply migrations in order and observe concurrent database lock waits. */
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import {
  claimReadyScheduledAgentRuns,
  createScheduledAgentJob,
  materializeDueScheduledAgentRuns,
} from "@db/services/scheduled-agent-jobs";
import { ensureScope } from "@db/services/scope";

// Explicit opt-in: this test creates and drops its own database on a local server.
// oxlint-disable-next-line eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- Test bootstrap accepts a local PostgreSQL admin connection only.
const connectionString = process.env.OPENINSTINCT_TEST_POSTGRES_URL;

it.skipIf(!connectionString)(
  "preserves two distinct catch-up wakeups contending on the same job",
  async () => {
    if (!connectionString) throw new Error("Expected the test server URL.");
    const origin = new URL(connectionString);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
      throw new Error("Use a local PostgreSQL test server.");
    const name = "openinstinct_wake_test_" + randomUUID().replaceAll("-", "");
    const admin = new Pool({ connectionString });
    await admin.query(`CREATE DATABASE "${name}"`);
    origin.pathname = "/" + name;
    const pool = new Pool({ connectionString: origin.toString() });
    try {
      const directory = new URL("../migrations/", import.meta.url);
      for (const filename of (await readdir(directory))
        .filter((entry) => entry.endsWith(".sql"))
        .toSorted()) {
        await pool.query(await readFile(new URL(filename, directory), "utf8"));
      }
      const database = drizzle({ client: pool, schema });
      vi.spyOn(Database, "db", "get").mockReturnValue(database);
      const scope = {
        userId: "contention-user",
        workspaceId: "contention-workspace",
      };
      await ensureScope(scope);
      const created = new Date("2026-10-05T12:00:00Z");
      const due = new Date("2026-10-05T12:01:00Z");
      const now = new Date("2026-10-05T12:03:00Z");
      const job = await createScheduledAgentJob(
        scope,
        {
          conversationChannel: "eve",
          conversationId: "contention-session",
          missedRunPolicy: "catch_up",
          prompt: "Check the train.",
          timing: {
            kind: "interval",
            anchoredAt: due.toISOString(),
            everyMinutes: 1,
          },
        },
        created
      );
      const [runId] = await materializeDueScheduledAgentRuns({
        limit: 1,
        now,
        job: { id: job.id, revision: job.revision, at: due },
      });
      if (!runId) throw new Error("Expected the first catch-up occurrence.");
      const lock = await pool.connect();
      let operations: ReturnType<typeof Promise.allSettled> | undefined;
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT id FROM scheduled_agent_jobs WHERE id = $1 FOR UPDATE",
          [job.id]
        );
        const nextOccurrence = materializeDueScheduledAgentRuns({
          limit: 1,
          now,
          job: {
            id: job.id,
            revision: job.revision,
            at: new Date(due.getTime() + 60_000),
          },
        });
        const worker = claimReadyScheduledAgentRuns({
          limit: 1,
          now,
          leaseForMs: 300_000,
          wakeup: { runId, attempts: 0, leaseToken: null },
        });
        operations = Promise.allSettled([nextOccurrence, worker]);
        const deadline = Date.now() + 2_000;
        let waiting = 0;
        while (waiting < 2 && Date.now() < deadline) {
          const result = await admin.query<{ waiting: number }>(
            "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'",
            [name]
          );
          waiting = result.rows[0]?.waiting ?? 0;
          if (waiting < 2) await setTimeout(10);
        }
        expect(waiting).toBe(2);
        await lock.query("COMMIT");
        const [occurrences, claims] = await Promise.all([
          nextOccurrence,
          worker,
        ]);
        expect(occurrences).toHaveLength(1);
        expect(claims).toHaveLength(1);
        expect(claims[0]?.run.id).toBe(runId);
        expect(
          (await database.query.scheduledAgentRuns.findMany()).length
        ).toBe(2);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
        if (operations) await operations;
      }
    } finally {
      vi.restoreAllMocks();
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
  20_000
);

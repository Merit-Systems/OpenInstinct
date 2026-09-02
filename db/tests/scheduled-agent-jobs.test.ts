/* oxlint-disable eslint/no-await-in-loop -- Migrations and their statements must be applied in order. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@/db";
import * as schema from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("scheduled agent jobs", () => {
  it("materializes one occurrence, leases its worker, and persists reporting", async () => {
    const client = new PGlite();
    databases.push(client);
    for (const migration of [
      "0000_fluffy_the_spike.sql",
      "0001_better-auth.sql",
      "0002_heavy_celestials.sql",
      "0003_unusual_fabian_cortez.sql",
      "0004_kind_manta.sql",
      "0005_brave_kang.sql",
      "0006_illegal_tattoo.sql",
      "0007_small_mandarin.sql",
    ]) {
      await applyMigration(client, migration);
    }

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const scope = await import("@/db/services/scope");
    const jobs = await import("@/db/services/scheduled-agent-jobs");
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };
    await scope.ensureScope(alice);
    await scope.ensureScope(bob);

    const now = new Date("2026-09-01T12:00:00.000Z");
    const created = await jobs.createScheduledAgentJob(
      alice,
      {
        linqThreadId: "linq:chat-alice",
        missedRunPolicy: "run_latest",
        prompt: "Check for a material price change.",
        timing: {
          anchoredAt: "2026-09-01T13:00:00.000Z",
          everyMinutes: 60,
          kind: "interval",
        },
      },
      now
    );
    expect(await jobs.listScheduledAgentJobs(bob)).toEqual([]);
    expect(await jobs.listScheduledAgentJobs(alice)).toEqual([created]);
    await jobs.updateScheduledAgentJob(
      alice,
      created.id,
      { prompt: "Check for a meaningful price change." },
      new Date("2026-09-01T12:30:00.000Z")
    );
    expect(await jobs.listScheduledAgentJobs(alice)).toEqual([
      expect.objectContaining({
        nextRunAt: new Date("2026-09-01T13:00:00.000Z"),
        prompt: "Check for a meaningful price change.",
      }),
    ]);

    const dueAt = new Date("2026-09-01T13:00:00.000Z");
    await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: dueAt });
    expect(
      await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: dueAt })
    ).toEqual([]);
    let [claim] = await jobs.claimReadyScheduledAgentRuns({
      leaseForMs: 21_600_000,
      limit: 25,
      now: dueAt,
    });
    if (!claim?.run.leaseToken) throw new Error("Expected one leased run.");
    expect(claim).toMatchObject({
      job: { id: created.id, linqThreadId: "linq:chat-alice" },
      run: { attempts: 1, scheduledFor: dueAt },
    });
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: dueAt,
      })
    ).toEqual([]);

    await jobs.setScheduledRunSession(
      claim.run.id,
      claim.run.leaseToken,
      "worker-session"
    );
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: new Date("2026-09-01T13:10:00.000Z"),
      })
    ).toEqual([]);
    const [recoveredWorker] = await jobs.claimReadyScheduledAgentRuns({
      leaseForMs: 21_600_000,
      limit: 25,
      now: new Date("2026-09-01T19:01:00.000Z"),
    });
    if (!recoveredWorker?.run.leaseToken) {
      throw new Error("Expected the interrupted worker to be reclaimed.");
    }
    expect(recoveredWorker.run).toMatchObject({
      attempts: 2,
      workerSessionId: "worker-session",
    });
    claim = recoveredWorker;
    await jobs.setScheduledRunSession(
      claim.run.id,
      claim.run.leaseToken,
      "replacement-worker-session"
    );
    const completed = await jobs.completeScheduledAgentRun(
      claim.run.id,
      claim.run.leaseToken,
      {
        kind: "result",
        summary: "The price fell to $250.",
        urgency: "normal",
      },
      new Date("2026-09-01T13:02:00.000Z")
    );
    expect(completed).toMatchObject({
      reportStatus: "pending",
      status: "completed",
      workerSessionId: "replacement-worker-session",
    });
    const report = await jobs.claimScheduledReport(claim.run.id, dueAt);
    expect(report).toMatchObject({
      job: { id: created.id },
      run: { reportStatus: "queued" },
    });
    const recovered = await Promise.all([
      jobs.listRecoverableScheduledReports(
        new Date("2026-09-01T13:10:00.000Z")
      ),
      jobs.listRecoverableScheduledReports(
        new Date("2026-09-01T13:10:00.000Z")
      ),
    ]);
    expect(recovered.flat()).toContain(claim.run.id);
    const competingClaims = await Promise.all([
      jobs.claimScheduledReport(claim.run.id, dueAt),
      jobs.claimScheduledReport(claim.run.id, dueAt),
    ]);
    expect(competingClaims.filter(Boolean)).toHaveLength(1);
    const currentReportLease = competingClaims.find(
      (candidate) => candidate !== undefined
    )?.run.leaseToken;
    if (!currentReportLease) throw new Error("Expected one report lease.");
    await jobs.finalizeScheduledReport(
      claim.run.id,
      "00000000-0000-4000-8000-000000000099",
      "delivered"
    );
    expect(
      await jobs.listRecoverableScheduledReports(
        new Date("2026-09-01T13:04:00.000Z")
      )
    ).toEqual([]);
    await jobs.finalizeScheduledReport(
      claim.run.id,
      currentReportLease,
      "delivered"
    );
    expect(await jobs.listRecoverableScheduledReports(dueAt)).toEqual([]);

    expect(
      await jobs.updateScheduledAgentJob(bob, created.id, { status: "paused" })
    ).toBeUndefined();
    expect(await jobs.listScheduledAgentJobs(alice)).toEqual([
      expect.objectContaining({
        nextRunAt: new Date("2026-09-01T14:00:00.000Z"),
        status: "active",
      }),
    ]);
  }, 15_000);
});

async function applyMigration(database: PGlite, filename: string) {
  const source = await readFile(
    new URL(`../migrations/${filename}`, import.meta.url),
    "utf8"
  );
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

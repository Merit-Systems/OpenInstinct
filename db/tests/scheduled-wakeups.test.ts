/* oxlint-disable eslint/no-await-in-loop -- Versioned migrations must run in order. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import * as jobs from "@db/services/scheduled-agent-jobs";
import * as wakeups from "@db/services/scheduled-agent-wakeups";
import * as registrations from "@db/services/scheduled-wakeup-registrations";
import { ensureScope } from "@db/services/scope";
import type { ScheduledWakeup } from "@shared/schedules/wakeups";

const databases: PGlite[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

const scope = { userId: "wake-user", workspaceId: "workspace:wake-user" };
const conversation = {
  conversationChannel: "linq" as const,
  conversationId: "linq:dm:wake-user",
};
const now = new Date("2026-10-05T12:00:00.000Z");
const due = new Date("2026-10-05T13:00:00.000Z");
const jobId = "10000000-0000-4000-8000-000000000001";

async function setup() {
  const client = new PGlite();
  databases.push(client);
  const directory = new URL("../migrations/", import.meta.url);
  for (const migrationFilename of (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted()) {
    for (const statement of (
      await readFile(new URL(migrationFilename, directory), "utf8")
    ).split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  const database = drizzle(client, { schema });
  // SAFETY: PGlite exercises the real Drizzle schema and transactional queries through a different driver.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mock the database at its owning boundary.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  await ensureScope(scope);
  return jobs.createScheduledAgentJob(
    scope,
    {
      ...conversation,
      id: jobId,
      missedRunPolicy: "run_latest",
      prompt: "Check the train.",
      timing: { kind: "once", at: due.toISOString() },
    },
    now
  );
}

describe("scheduled wakeup persistence", () => {
  it("replays mutations and rejects stale timers and competing updates", async () => {
    const job = await setup();
    expect(
      (
        await jobs.createScheduledAgentJob(
          scope,
          {
            ...conversation,
            id: jobId,
            missedRunPolicy: "run_latest",
            prompt: "Duplicate.",
            timing: { kind: "once", at: due.toISOString() },
          },
          new Date("2027-01-01T00:00:00.000Z")
        )
      ).prompt
    ).toBe(job.prompt);
    const mutation = {
      id: "10000000-0000-4000-8000-000000000002",
      revision: job.revision,
    };
    const paused = await jobs.updateScheduledAgentJob(
      scope,
      conversation,
      job.id,
      { status: "paused" },
      now,
      mutation
    );
    expect(paused?.revision).toBe(1);
    expect(
      (
        await jobs.updateScheduledAgentJob(
          scope,
          conversation,
          job.id,
          { status: "paused" },
          now,
          mutation
        )
      )?.revision
    ).toBe(1);
    expect(
      await jobs.updateScheduledAgentJob(
        scope,
        conversation,
        job.id,
        { prompt: "Conflicting update." },
        now,
        { id: "10000000-0000-4000-8000-000000000003", revision: 0 }
      )
    ).toBeUndefined();
    expect(
      await jobs.materializeDueScheduledAgentRuns({
        limit: 1,
        now: due,
        job: { id: job.id, revision: 0, at: due },
      })
    ).toEqual([]);
    const resumed = await jobs.updateScheduledAgentJob(
      scope,
      conversation,
      job.id,
      { status: "active" },
      now,
      { id: "10000000-0000-4000-8000-000000000004", revision: 1 }
    );
    expect(resumed?.revision).toBe(2);
    expect(
      await jobs.updateScheduledAgentJob(
        scope,
        conversation,
        job.id,
        { status: "paused" },
        now,
        mutation
      )
    ).toBeUndefined();
    expect(
      await jobs.materializeDueScheduledAgentRuns({
        limit: 1,
        now: due,
        job: { id: job.id, revision: 0, at: due },
      })
    ).toEqual([]);
    const occurrences = await Promise.all(
      [0, 1].map(() =>
        jobs.materializeDueScheduledAgentRuns({
          limit: 1,
          now: due,
          job: { id: job.id, revision: 2, at: due },
        })
      )
    );
    expect(occurrences.flat()).toHaveLength(1);
  }, 20_000);

  it("targets run attempts, reclaims only startup leases, and retries reports at their deadline", async () => {
    await setup();
    const [runId] = await jobs.materializeDueScheduledAgentRuns({
      limit: 1,
      now: due,
      job: { id: jobId, revision: 0, at: due },
    });
    if (!runId) throw new Error("Expected one occurrence.");
    const pending = (await wakeups.scheduledRunWakeups(runId))[0];
    if (pending?.kind !== "run") throw new Error("Expected a run wakeup.");
    const [claim] = await jobs.claimReadyScheduledAgentRuns({
      limit: 1,
      leaseForMs: 300_000,
      now: due,
      wakeup: pending,
    });
    if (!claim) throw new Error("Expected a run claim.");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 1,
        leaseForMs: 300_000,
        now: due,
        wakeup: pending,
      })
    ).toEqual([]);
    const recovery = (await wakeups.scheduledRunWakeups(runId))[0];
    if (recovery?.kind !== "run")
      throw new Error("Expected a startup deadline.");
    const after = new Date(due.getTime() + 301_000);
    const [retry] = await jobs.claimReadyScheduledAgentRuns({
      limit: 1,
      leaseForMs: 300_000,
      now: after,
      wakeup: recovery,
    });
    if (!retry) throw new Error("Expected a reclaimed startup.");
    expect(retry.run.attempts).toBe(2);
    expect(retry.run.leaseToken).not.toBe(claim.run.leaseToken);
    await jobs.setScheduledRunSession(
      runId,
      retry.run.leaseToken,
      "accepted-session"
    );
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 1,
        leaseForMs: 300_000,
        now: new Date(after.getTime() + 301_000),
      })
    ).toEqual([]);
    expect(await wakeups.scheduledRunWakeups(runId)).toEqual([]);
    await jobs.completeScheduledAgentRun(
      runId,
      retry.run.leaseToken,
      "turn-1",
      { kind: "result", summary: "The train is running.", urgency: "normal" },
      after
    );
    expect(await jobs.claimScheduledReport(runId, after, 2)).toBeUndefined();
    const report = await jobs.claimScheduledReport(runId, after, 1);
    if (!report?.run.reportLeaseToken)
      throw new Error("Expected a report claim.");
    await jobs.releaseScheduledReport(
      runId,
      report.run.reportLeaseToken,
      "Temporary provider failure.",
      after
    );
    expect(
      await jobs.claimScheduledReport(
        runId,
        new Date(after.getTime() + 59_000),
        1
      )
    ).toBeUndefined();
    expect(
      (
        await jobs.claimScheduledReport(
          runId,
          new Date(after.getTime() + 60_000),
          1
        )
      )?.run.reportLeaseToken
    ).not.toBe(report.run.reportLeaseToken);
    expect((await wakeups.backfillScheduledWakeups("run")).wakeups).toEqual([
      expect.objectContaining({ kind: "report", runId, sequence: 1 }),
    ]);
  }, 20_000);

  it("bridges accepted legacy workers after their one-time job has completed", async () => {
    await setup();
    const [runId] = await jobs.materializeDueScheduledAgentRuns({
      limit: 1,
      now: due,
    });
    if (!runId) throw new Error("Expected one occurrence.");
    const [claim] = await jobs.claimReadyScheduledAgentRuns({
      limit: 1,
      leaseForMs: 300_000,
      now: due,
    });
    if (!claim) throw new Error("Expected a run claim.");
    await jobs.setScheduledRunSession(
      runId,
      claim.run.leaseToken,
      "legacy-session"
    );
    await Database.db
      .update(schema.scheduledAgentRuns)
      .set({ wakeupManaged: false })
      .where(eq(schema.scheduledAgentRuns.id, runId));
    expect((await wakeups.backfillScheduledWakeups()).wakeups).toEqual([]);
    const backfill = await wakeups.backfillScheduledWakeups("run");
    expect(backfill.wakeups).toEqual([
      expect.objectContaining({ kind: "legacy-run", runId }),
    ]);
    const observer = backfill.wakeups[0];
    if (observer?.kind !== "legacy-run")
      throw new Error("Expected a legacy observer.");
    // The old worker writes its outcome directly, without enqueueing a report timer.
    await jobs.completeScheduledAgentRun(
      runId,
      claim.run.leaseToken,
      "legacy-turn",
      { kind: "result", summary: "The train is running.", urgency: "normal" },
      due
    );
    expect(await wakeups.observeScheduledRun(runId, observer.deadline)).toEqual(
      [expect.objectContaining({ kind: "report", runId, sequence: 1 })]
    );
  }, 20_000);

  it("rechecks a schedule changed between invalidation and claiming", async () => {
    await setup();
    const [runId] = await jobs.materializeDueScheduledAgentRuns({
      limit: 1,
      now: due,
    });
    if (!runId) throw new Error("Expected one occurrence.");
    const client = databases.at(-1);
    if (!client) throw new Error("Expected a test database.");
    // A statement trigger changes the job after the invalidation statement, even
    // when it touches zero rows, reproducing the interleaving before the claim SELECT.
    await client.exec(`
      CREATE FUNCTION pause_before_claim() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE scheduled_agent_jobs SET status = 'paused', revision = revision + 1
          WHERE id = '${jobId}';
        RETURN NULL;
      END;
      $$;
      CREATE TRIGGER pause_before_claim AFTER UPDATE ON scheduled_agent_runs
        FOR EACH STATEMENT EXECUTE FUNCTION pause_before_claim();
    `);
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 1,
        leaseForMs: 300_000,
        now: due,
      })
    ).toEqual([]);
    const run = await Database.db.query.scheduledAgentRuns.findFirst({
      where: eq(schema.scheduledAgentRuns.id, runId),
    });
    expect(run?.attempts).toBe(0);
    expect(run?.status).toBe("queued");
  }, 20_000);

  it("deduplicates registrations, permits owner replay, and fences expired owners", async () => {
    await setup();
    const wakeup: ScheduledWakeup = {
      kind: "job",
      jobId,
      revision: 0,
      at: due.toISOString(),
    };
    const claims = await Promise.all(
      ["parent-1", "parent-2"].map((owner) =>
        registrations.claimScheduledWakeup(wakeup, owner, now)
      )
    );
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    const first = claims[0];
    if (!first?.claimed) throw new Error("Expected the first owner.");
    expect(
      (await registrations.claimScheduledWakeup(wakeup, "parent-1", now))
        .claimed
    ).toBe(true);
    expect(
      (await registrations.claimScheduledWakeup(wakeup, "parent-2", now))
        .claimed
    ).toBe(false);
    expect(
      (
        await registrations.claimScheduledWakeup(
          wakeup,
          "parent-2",
          new Date(now.getTime() + 301_000)
        )
      ).claimed
    ).toBe(true);
    expect(
      await registrations.recordScheduledWakeup(
        first.key,
        "parent-1",
        "old-workflow"
      )
    ).toBe(false);
    expect(
      await registrations.recordScheduledWakeup(
        first.key,
        "parent-2",
        "current-workflow"
      )
    ).toBe(true);
    expect(
      (
        await registrations.claimScheduledWakeup(
          { at: wakeup.at, revision: 0, jobId, kind: "job" },
          "parent-3",
          now
        )
      ).workflowRunId
    ).toBe("current-workflow");
    await registrations.releaseScheduledWakeup(wakeup, "old-workflow");
    expect(
      (await registrations.claimScheduledWakeup(wakeup, "parent-3", now))
        .claimed
    ).toBe(false);
    await registrations.releaseScheduledWakeup(wakeup, "current-workflow");
    expect(
      (await registrations.claimScheduledWakeup(wakeup, "parent-3", now))
        .claimed
    ).toBe(true);
  }, 20_000);
});

/* oxlint-disable eslint/no-await-in-loop -- Apply migrations in order. */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as schema from "../schema";

const databases: PGlite[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function setup() {
  const client = new PGlite();
  databases.push(client);
  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() })) })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../migrations/meta/_journal.json", import.meta.url),
          "utf8"
        )
      )
    );
  for (const { tag } of journal.entries) {
    const source = await readFile(
      new URL(`../migrations/${tag}.sql`, import.meta.url),
      "utf8"
    );
    for (const statement of source.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  const database = drizzle(client, { schema });
  // SAFETY: PGlite exercises the same Drizzle query surface with the application's schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the database driver is replaced.
  vi.spyOn(await import("@db"), "db", "get").mockReturnValue(database as never);
  return {
    database,
    jobs: await import("@db/services/scheduled-agent-jobs"),
    wakeups: await import("@db/services/conversation-wakeups"),
  };
}

const alice = { userId: "alice", workspaceId: "workspace:alice" };
const bob = { userId: "bob", workspaceId: "workspace:bob" };
const conversation = {
  conversationChannel: "linq" as const,
  conversationId: "linq:alice",
};
const now = new Date("2026-09-08T13:00:00Z");
const tomorrow = new Date("2026-09-09T13:00:00Z");

describe("default conversation wakeups", () => {
  it("creates once, preserves all user changes, and retains deleted opt-outs", async () => {
    const { jobs, wakeups } = await setup();
    await Promise.all([
      wakeups.ensureDailyCheckIn(
        alice,
        conversation.conversationId,
        "Observe, orient, decide, act.",
        now
      ),
      wakeups.ensureDailyCheckIn(
        alice,
        conversation.conversationId,
        "Observe, orient, decide, act.",
        now
      ),
    ]);
    const [job] = await jobs.listScheduledAgentJobs(alice, conversation);
    if (!job) throw new Error("Missing default schedule.");
    expect(job).toMatchObject({
      defaultKey: "daily-check-in",
      execution: "conversation",
      nextRunAt: tomorrow,
      timing: { everyMinutes: 1440 },
    });
    expect(await jobs.listScheduledAgentJobs(bob, conversation)).toEqual([]);
    expect(
      await jobs.updateScheduledAgentJob(bob, conversation, job.id, {
        status: "paused",
      })
    ).toBeUndefined();
    await jobs.updateScheduledAgentJob(
      alice,
      conversation,
      job.id,
      {
        prompt: "Only check upcoming commitments.",
        status: "paused",
        timing: {
          kind: "calendar",
          frequency: "weekly",
          weekday: 1,
          localTime: "09:00",
          timezone: "America/New_York",
        },
      },
      now
    );
    await wakeups.ensureDailyCheckIn(
      alice,
      "linq:another-chat",
      "New default",
      tomorrow
    );
    expect(
      await jobs.listScheduledAgentJobs(alice, conversation)
    ).toMatchObject([
      {
        id: job.id,
        prompt: "Only check upcoming commitments.",
        status: "paused",
        nextRunAt: null,
        timing: { frequency: "weekly", timezone: "America/New_York" },
      },
    ]);
    expect(
      await jobs.listScheduledAgentJobs(alice, {
        ...conversation,
        conversationId: "linq:another-chat",
      })
    ).toEqual([]);
    const resumed = await jobs.updateScheduledAgentJob(
      alice,
      conversation,
      job.id,
      { status: "active" },
      tomorrow
    );
    expect(resumed?.nextRunAt).toEqual(new Date("2026-09-14T13:00:00Z"));
    await jobs.updateScheduledAgentJob(alice, conversation, job.id, {
      status: "deleted",
    });
    await wakeups.ensureDailyCheckIn(
      alice,
      conversation.conversationId,
      "New default",
      tomorrow
    );
    expect(await jobs.listScheduledAgentJobs(alice, conversation)).toEqual([]);
  }, 20_000);

  it("claims one wake-up and never retries an uncertain dispatch", async () => {
    const { jobs, wakeups } = await setup();
    await wakeups.ensureDailyCheckIn(
      alice,
      conversation.conversationId,
      "Check in",
      now
    );
    await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: tomorrow });
    expect(
      await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: tomorrow })
    ).toEqual([]);
    const [claim] = await jobs.claimReadyScheduledAgentRuns({
      limit: 25,
      leaseForMs: 300_000,
      now: tomorrow,
    });
    if (!claim) throw new Error("Missing claimed wake-up.");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 25,
        leaseForMs: 300_000,
        now: tomorrow,
      })
    ).toEqual([]);
    const afterExpiry = new Date("2026-09-09T13:06:00Z");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 25,
        leaseForMs: 300_000,
        now: afterExpiry,
      })
    ).toEqual([]);
    await wakeups.expireConversationWakeups(afterExpiry);
    expect(
      await jobs.listScheduledAgentJobs(alice, conversation)
    ).toMatchObject([
      {
        nextRunAt: new Date("2026-09-10T13:00:00Z"),
        latestRun: { status: "dead_letter", reportStatus: "not_needed" },
      },
    ]);
    expect(await jobs.listRecoverableScheduledReports(afterExpiry)).toEqual([]);
  }, 20_000);

  it("suppresses pending wake-ups on edits and rejects stale queued turns", async () => {
    const { jobs, wakeups } = await setup();
    await wakeups.ensureDailyCheckIn(
      alice,
      conversation.conversationId,
      "Check in",
      now
    );
    const [job] = await jobs.listScheduledAgentJobs(alice, conversation);
    if (!job) throw new Error("Missing job.");
    await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: tomorrow });
    expect(
      await wakeups.isConversationWakeupCurrent(
        alice,
        job.id,
        job.revision,
        conversation.conversationId
      )
    ).toBe(true);
    expect(
      await wakeups.isConversationWakeupCurrent(
        bob,
        job.id,
        job.revision,
        conversation.conversationId
      )
    ).toBe(false);
    await jobs.updateScheduledAgentJob(
      alice,
      conversation,
      job.id,
      { status: "paused" },
      tomorrow
    );
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        limit: 25,
        leaseForMs: 300_000,
        now: tomorrow,
      })
    ).toEqual([]);
    expect(
      await wakeups.isConversationWakeupCurrent(
        alice,
        job.id,
        job.revision,
        conversation.conversationId
      )
    ).toBe(false);
    await jobs.updateScheduledAgentJob(
      alice,
      conversation,
      job.id,
      { status: "active" },
      tomorrow
    );
    expect(
      await wakeups.isConversationWakeupCurrent(
        alice,
        job.id,
        job.revision,
        conversation.conversationId
      )
    ).toBe(false);
    const nextDay = new Date("2026-09-10T13:00:00Z");
    await jobs.materializeDueScheduledAgentRuns({ limit: 25, now: nextDay });
    const [claim] = await jobs.claimReadyScheduledAgentRuns({
      limit: 25,
      leaseForMs: 300_000,
      now: nextDay,
    });
    if (!claim) throw new Error("Missing resumed wake-up.");
    await wakeups.finishConversationWakeup(claim);
    expect(
      await jobs.listScheduledAgentJobs(alice, conversation)
    ).toMatchObject([
      { latestRun: { status: "completed", reportStatus: "not_needed" } },
    ]);
    expect(await jobs.listRecoverableScheduledReports(nextDay)).toEqual([]);
  }, 20_000);
});

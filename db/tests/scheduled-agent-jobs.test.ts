import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@/db";
import * as schema from "../schema";
import { applyAllMigrations } from "./helpers/migrations";

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
    await applyAllMigrations(client);
    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by this service while retaining the shared Drizzle schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
    vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
    const scope = await import("@/db/services/scope");
    const jobs = await import("@/db/services/scheduled-agent-jobs");
    const leases = await import("@/db/services/scheduled-agent-run-leases");
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };
    const aliceConversation = {
      conversationChannel: "linq" as const,
      conversationId: "linq:chat-alice",
    };
    const bobConversation = {
      conversationChannel: "linq" as const,
      conversationId: "linq:chat-bob",
    };
    await scope.ensureScope(alice);
    await scope.ensureScope(bob);

    const now = new Date("2026-09-01T12:00:00.000Z");
    const created = await jobs.createScheduledAgentJob(
      alice,
      {
        ...aliceConversation,
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
    expect(await jobs.listScheduledAgentJobs(bob, aliceConversation)).toEqual(
      []
    );
    expect(await jobs.listScheduledAgentJobs(alice, bobConversation)).toEqual(
      []
    );
    expect(await jobs.listScheduledAgentJobs(alice, aliceConversation)).toEqual(
      [{ ...created, latestRun: null }]
    );
    await jobs.updateScheduledAgentJob(
      alice,
      aliceConversation,
      created.id,
      { prompt: "Check for a meaningful price change." },
      new Date("2026-09-01T12:30:00.000Z")
    );
    expect(await jobs.listScheduledAgentJobs(alice, aliceConversation)).toEqual(
      [
        expect.objectContaining({
          nextRunAt: new Date("2026-09-01T13:00:00.000Z"),
          prompt: "Check for a meaningful price change.",
        }),
      ]
    );

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
      job: { id: created.id, ...aliceConversation },
      run: { attempts: 1, scheduledFor: dueAt, startedAt: null },
    });
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: dueAt,
      })
    ).toEqual([]);

    expect(
      await jobs.setScheduledRunSession(
        claim.run.id,
        claim.run.leaseToken,
        "worker-session"
      )
    ).toBe(true);
    const workerStartedAt = new Date("2026-09-01T13:00:05.000Z");
    expect(
      await jobs.markScheduledAgentRunStarted(
        claim.run.id,
        claim.run.leaseToken,
        "worker-session",
        21_600_000,
        workerStartedAt
      )
    ).toBe(true);
    expect(
      await leases.isScheduledAgentRunLeaseActive(
        claim.run.id,
        claim.run.leaseToken,
        new Date("2026-09-01T13:00:06.000Z")
      )
    ).toBe(true);
    expect(
      await jobs.markScheduledAgentRunStarted(
        claim.run.id,
        claim.run.leaseToken,
        "worker-session",
        21_600_000,
        new Date("2026-09-01T13:00:10.000Z")
      )
    ).toBe(true);
    expect(
      await jobs.markScheduledAgentRunStarted(
        claim.run.id,
        "00000000-0000-4000-8000-000000000099",
        "stale-worker-session",
        21_600_000,
        workerStartedAt
      )
    ).toBe(false);
    const [listedJob] = await jobs.listScheduledAgentJobs(
      alice,
      aliceConversation
    );
    expect(listedJob?.latestRun).toMatchObject({
      id: claim.run.id,
      startedAt: workerStartedAt,
      status: "running",
      workerSessionId: "worker-session",
    });
    const question = {
      action: {
        callId: "call-question",
        input: { prompt: "Which airport should I use?" },
        kind: "tool-call" as const,
        toolName: "ask_question",
      },
      allowFreeform: true,
      kind: "question" as const,
      prompt: "Which airport should I use?",
      requestId: "request-question",
    };
    const waiting = await jobs.waitForScheduledAgentRunInput(
      claim.run.id,
      claim.run.leaseToken,
      [question],
      new Date("2026-09-01T13:01:00.000Z")
    );
    expect(waiting).toMatchObject({
      pendingInputRequests: [question],
      reportSequence: 1,
      reportStatus: "pending",
      status: "waiting_for_input",
    });
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: new Date("2026-09-02T13:00:00.000Z"),
      })
    ).toEqual([]);
    const questionReport = await jobs.claimScheduledReport(
      claim.run.id,
      new Date("2026-09-01T13:01:30.000Z")
    );
    if (!questionReport?.run.reportLeaseToken) {
      throw new Error("Expected the pending question to be reportable.");
    }
    expect(
      await jobs.getScheduledAgentRunInputForReport(
        claim.run.id,
        questionReport.run.reportLeaseToken
      )
    ).toMatchObject({ leaseToken: claim.run.leaseToken });
    expect(
      await jobs.getScheduledAgentRunInputForReport(
        claim.run.id,
        "00000000-0000-4000-8000-000000000099"
      )
    ).toBeUndefined();
    await jobs.finalizeScheduledReport(
      claim.run.id,
      questionReport.run.reportLeaseToken,
      "suppressed"
    );
    expect(
      await jobs.listRecoverableScheduledReports(
        new Date("2026-09-01T13:06:00.000Z")
      )
    ).toEqual([]);
    expect(
      await jobs.listRecoverableScheduledReports(
        new Date("2026-09-01T13:07:00.000Z")
      )
    ).toEqual([{ conversationChannel: "linq", runId: claim.run.id }]);
    const retriedQuestionReport = await jobs.claimScheduledReport(
      claim.run.id,
      new Date("2026-09-01T13:07:00.000Z")
    );
    if (!retriedQuestionReport?.run.reportLeaseToken) {
      throw new Error(
        "Expected the unanswered question to be reportable again."
      );
    }
    await jobs.finalizeScheduledReport(
      claim.run.id,
      retriedQuestionReport.run.reportLeaseToken,
      "delivered"
    );
    expect(
      await jobs.getScheduledAgentRunInput(bob, aliceConversation, claim.run.id)
    ).toBeUndefined();
    expect(
      await jobs.getScheduledAgentRunInput(alice, bobConversation, claim.run.id)
    ).toBeUndefined();
    expect(
      await jobs.getScheduledAgentRunInput(
        alice,
        aliceConversation,
        claim.run.id
      )
    ).toMatchObject({
      leaseToken: claim.run.leaseToken,
    });
    const resumed = await jobs.claimScheduledAgentRunInput(
      claim.run.id,
      claim.run.leaseToken,
      new Date("2026-09-01T13:02:00.000Z")
    );
    expect(resumed).toMatchObject({
      run: { pendingInputRequests: [question], status: "running" },
    });
    await jobs.finishScheduledAgentRunInput(
      claim.run.id,
      claim.run.leaseToken,
      new Date("2026-09-01T13:02:01.000Z")
    );
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: new Date("2026-09-01T19:03:00.000Z"),
      })
    ).toEqual([]);
    expect(
      await jobs.releaseScheduledAgentRun(
        claim.run.id,
        claim.run.leaseToken,
        "Worker failed after resumption.",
        new Date("2026-09-01T19:03:00.000Z")
      )
    ).toBe("queued");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: new Date("2026-09-01T19:07:00.000Z"),
      })
    ).toEqual([]);
    const [recoveredWorker] = await jobs.claimReadyScheduledAgentRuns({
      leaseForMs: 21_600_000,
      limit: 25,
      now: new Date("2026-09-01T19:08:00.000Z"),
    });
    if (!recoveredWorker?.run.leaseToken) {
      throw new Error("Expected the interrupted worker to be reclaimed.");
    }
    expect(recoveredWorker.run).toMatchObject({
      attempts: 2,
      startedAt: null,
      workerSessionId: "worker-session",
    });
    claim = recoveredWorker;
    await jobs.setScheduledRunSession(
      claim.run.id,
      claim.run.leaseToken,
      "replacement-worker-session"
    );
    expect(
      await jobs.deferScheduledAgentRunCompletion(
        claim.run.id,
        claim.run.leaseToken,
        "turn-1",
        new Date("2026-09-01T13:01:59.000Z")
      )
    ).toBe(true);
    expect(
      await jobs.completeScheduledAgentRun(
        claim.run.id,
        claim.run.leaseToken,
        "turn-1",
        {
          kind: "result",
          summary: "Browser research is still running.",
          urgency: "normal",
        },
        new Date("2026-09-01T13:02:00.000Z")
      )
    ).toEqual({ status: "deferred" });
    expect(
      await jobs.completeScheduledAgentRun(
        claim.run.id,
        claim.run.leaseToken,
        "turn-2",
        {
          kind: "nothing_to_report",
          reason: "Another background task is still running.",
        },
        new Date("2026-09-01T13:02:01.000Z")
      )
    ).toEqual({ status: "deferred" });
    const completed = await jobs.completeScheduledAgentRun(
      claim.run.id,
      claim.run.leaseToken,
      "turn-3",
      {
        kind: "result",
        summary: "The price fell to $250.",
        urgency: "normal",
      },
      new Date("2026-09-01T13:02:02.000Z")
    );
    expect(completed).toMatchObject({
      status: "completed",
      run: {
        deferredCompletionTurnId: null,
        reportSequence: 2,
        reportStatus: "pending",
        status: "completed",
        workerSessionId: "replacement-worker-session",
      },
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
    expect(recovered.flat().map(({ runId }) => runId)).toContain(claim.run.id);
    const competingClaims = await Promise.all([
      jobs.claimScheduledReport(claim.run.id, dueAt),
      jobs.claimScheduledReport(claim.run.id, dueAt),
    ]);
    expect(competingClaims.filter(Boolean)).toHaveLength(1);
    const currentReportLease = competingClaims.find(
      (candidate) => candidate !== undefined
    )?.run.reportLeaseToken;
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
      await jobs.updateScheduledAgentJob(bob, aliceConversation, created.id, {
        status: "paused",
      })
    ).toBeUndefined();
    expect(
      await jobs.updateScheduledAgentJob(alice, bobConversation, created.id, {
        status: "paused",
      })
    ).toBeUndefined();
    expect(await jobs.listScheduledAgentJobs(alice, aliceConversation)).toEqual(
      [
        expect.objectContaining({
          nextRunAt: new Date("2026-09-01T14:00:00.000Z"),
          status: "active",
        }),
      ]
    );
    await jobs.updateScheduledAgentJob(alice, aliceConversation, created.id, {
      status: "paused",
    });
    await jobs.createScheduledAgentJob(
      bob,
      {
        ...bobConversation,
        missedRunPolicy: "run_latest",
        prompt: "Check the hourly value.",
        timing: {
          anchoredAt: "2026-09-01T13:00:00.000Z",
          everyMinutes: 60,
          kind: "interval",
        },
      },
      now
    );

    const recoveredAt = new Date("2026-09-08T13:30:00.000Z");
    await jobs.materializeDueScheduledAgentRuns({
      limit: 25,
      now: recoveredAt,
    });
    let [latestClaim] = await jobs.claimReadyScheduledAgentRuns({
      leaseForMs: 21_600_000,
      limit: 25,
      now: recoveredAt,
    });

    expect(latestClaim).toMatchObject({
      job: { nextRunAt: new Date("2026-09-08T14:00:00.000Z") },
      run: { scheduledFor: new Date("2026-09-08T13:00:00.000Z") },
    });
    let retryAt = recoveredAt;
    /* oxlint-disable eslint/no-await-in-loop -- Each retry depends on the previous release and claim. */
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!latestClaim?.run.leaseToken) {
        throw new Error("Expected a leased run.");
      }
      await jobs.releaseScheduledAgentRun(
        latestClaim.run.id,
        latestClaim.run.leaseToken,
        "Source unavailable.",
        retryAt
      );
      retryAt = new Date(retryAt.getTime() + 5 * 60_000);
      [latestClaim] = await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 21_600_000,
        limit: 25,
        now: retryAt,
      });
    }
    /* oxlint-enable eslint/no-await-in-loop */

    expect(await jobs.listScheduledAgentJobs(bob, bobConversation)).toEqual([
      expect.objectContaining({ lastError: "Source unavailable." }),
    ]);
    expect(
      await jobs.listScheduledAgentJobs(bob, {
        conversationChannel: "linq",
        conversationId: "linq:another-chat",
      })
    ).toEqual([]);

    const [acceptedRun] = await pgliteDatabase
      .insert(schema.scheduledAgentRuns)
      .values({
        attempts: 1,
        jobId: created.id,
        leaseExpiresAt: new Date("2026-09-09T13:05:00.000Z"),
        leaseToken: "00000000-0000-4000-8000-000000000010",
        scheduledFor: new Date("2026-09-09T13:00:00.000Z"),
        startedAt: null,
        status: "running",
        workerSessionId: "accepted-worker-session",
      })
      .returning();
    if (!acceptedRun) throw new Error("Expected an accepted worker run.");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 300_000,
        limit: 25,
        now: new Date("2026-09-09T13:06:00.000Z"),
      })
    ).toEqual([]);

    const [exhaustedRun] = await pgliteDatabase
      .insert(schema.scheduledAgentRuns)
      .values({
        attempts: 3,
        jobId: created.id,
        leaseExpiresAt: new Date("2026-09-09T14:05:00.000Z"),
        leaseToken: "00000000-0000-4000-8000-000000000011",
        scheduledFor: new Date("2026-09-09T14:00:00.000Z"),
        status: "running",
      })
      .returning();
    if (!exhaustedRun) throw new Error("Expected an exhausted worker run.");
    expect(
      await jobs.claimReadyScheduledAgentRuns({
        leaseForMs: 300_000,
        limit: 25,
        now: new Date("2026-09-09T14:06:00.000Z"),
      })
    ).toEqual([]);
    expect(
      await jobs.claimScheduledReport(
        exhaustedRun.id,
        new Date("2026-09-09T14:06:01.000Z")
      )
    ).toMatchObject({
      run: {
        outcome: {
          kind: "blocked",
          summary:
            "The scheduled task could not complete after three attempts.",
        },
        reportStatus: "queued",
        status: "dead_letter",
      },
    });
  }, 20_000);
});

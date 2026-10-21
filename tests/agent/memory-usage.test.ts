import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Database from "@db";
import type * as Environment from "@shared/environment";
import * as schema from "@db/schema";
import {
  claimMemoryJob,
  checkpointMemoryJob,
  deferMemoryJob,
  listReadyMemoryJobs,
  publishMemoryJob,
  rejectMemoryJob,
  releaseMemoryJob,
} from "@db/services/memory/jobs";
import {
  editMemoryRecord,
  forgetMemoryRecord,
  readMemoryRecord,
  saveMemoryRecord,
} from "@db/services/memory/records";
import { registerMemoryScope } from "@db/services/memory/scope";
import {
  captureMemorySource,
  readMemorySource,
} from "@db/services/memory/sources";
import {
  completeMemoryModelUsage,
  MemoryBudgetExceededError,
  MemoryRequestTooLargeError,
  readMemoryModelUsage,
  reserveMemoryModelUsage,
} from "@db/services/memory/usage";
import { ensureScope } from "@db/services/scope";

const limits = vi.hoisted(() => ({ tokens: 10_000, calls: 10 }));
vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof Environment>();
  return {
    ...original,
    env: {
      ...original.env,
      get KNOWLEDGE_MEMORY_DAILY_TOKENS() {
        return limits.tokens;
      },
      get KNOWLEDGE_MEMORY_DAILY_CALLS() {
        return limits.calls;
      },
    },
  };
});
const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "alice", workspaceId: "workspace-alice" };
const scopeKey = "knowledge-production";
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the production Drizzle contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise production queries with the isolated PGlite driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
  limits.tokens = 10_000;
  limits.calls = 10;
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  await database.insert(schema.agentSessions).values({
    sessionId: "alice",
    workspaceId: scope.workspaceId,
    createdByUserId: scope.userId,
  });
  await registerMemoryScope(scope, scopeKey, "production-knowledge", "alice");
});
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

async function claim(
  key = scopeKey,
  id = "source",
  text = "I prefer quiet trains."
) {
  await captureMemorySource(scope, key, {
    id,
    kind: "user",
    text,
    reference: `session:alice:turn:${id}`,
    sessionId: key === scopeKey ? "alice" : "second",
    turnId: id,
    observedAt: new Date().toISOString(),
  });
  const ready = (await listReadyMemoryJobs()).find(
    (job) => job.scopeKey === key
  );
  if (!ready) throw new Error("Expected ready memory job.");
  const job = await claimMemoryJob(scope, key, ready.id);
  if (!job) throw new Error("Expected claimed memory job.");
  return job;
}
const reserve = (
  job: { id: string; leaseToken: string },
  tokens = 4_000,
  key = scopeKey
) =>
  reserveMemoryModelUsage(scope, key, job, {
    modelId: "test-model",
    reservedTokens: tokens,
  });

async function secondScope() {
  await database.insert(schema.agentSessions).values({
    sessionId: "second",
    workspaceId: scope.workspaceId,
    createdByUserId: scope.userId,
  });
  await registerMemoryScope(scope, "second-key", "second-knowledge", "second");
  return claim("second-key", "second-source");
}

describe("workspace memory model budgets", () => {
  it("skips an oversized first source without charging or blocking a later affordable source", async () => {
    limits.tokens = 1_000;
    const largeText = `I prefer ${"quiet ".repeat(200)}trains.`;
    const job = await claim(scopeKey, "large", largeText);
    await expect(reserve(job, 2_000)).rejects.toBeInstanceOf(
      MemoryRequestTooLargeError
    );
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 0,
      chargedTokens: 0,
    });
    await rejectMemoryJob(scope, scopeKey, job.id, job.leaseToken);
    expect(await readMemorySource(scope, scopeKey, "large")).toBeNull();
    expect(
      await database
        .select()
        .from(schema.memorySources)
        .where(eq(schema.memorySources.id, "large"))
    ).toMatchObject([
      {
        status: "failed",
        text: null,
        reference: null,
        sessionId: null,
        turnId: null,
      },
    ]);
    expect(
      await database
        .select()
        .from(schema.memoryJobs)
        .where(eq(schema.memoryJobs.id, job.id))
    ).toMatchObject([
      { status: "dead_letter", checkpoint: null, sourceVersions: [] },
    ]);
    const next = await claim(scopeKey, "small", "I like tea.");
    expect(next.id).not.toBe(job.id);
    expect(next.sources.map((source) => source.id)).toEqual(["small"]);
    await reserve(next, 500);
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 1,
      chargedTokens: 500,
    });
  });

  it("preserves explicit evidence saved between oversized rejection and source cleanup", async () => {
    limits.tokens = 1_000;
    const job = await claim();
    await expect(reserve(job, 2_000)).rejects.toBeInstanceOf(
      MemoryRequestTooLargeError
    );
    const body = "I prefer quiet trains.";
    await saveMemoryRecord(
      scope,
      scopeKey,
      {
        id: "explicit",
        expectedRevision: 0,
        content: {
          kind: "preference",
          title: "Trains",
          body,
          evidence: [{ sourceId: "source", start: 0, end: body.length }],
        },
      },
      "explicit-save",
      { sourceId: "source" }
    );
    await rejectMemoryJob(scope, scopeKey, job.id, job.leaseToken);
    expect(await readMemorySource(scope, scopeKey, "source")).toMatchObject({
      status: "processed",
      text: body,
    });
    expect(await readMemoryRecord(scope, scopeKey, "explicit")).toMatchObject({
      explicit: true,
      content: { body },
    });
    expect(await readMemoryModelUsage(scope)).toMatchObject({ calls: 0 });
  });

  it.each(["tokens", "calls"] as const)(
    "treats zero %s as a pause without discarding an oversized input",
    async (limit) => {
      limits.tokens = 1;
      limits[limit] = 0;
      const job = await claim();
      await expect(reserve(job, 4_000)).rejects.toBeInstanceOf(
        MemoryBudgetExceededError
      );
      expect(await readMemorySource(scope, scopeKey, "source")).toMatchObject({
        status: "pending",
        text: "I prefer quiet trains.",
      });
      expect(await readMemoryModelUsage(scope)).toMatchObject({ calls: 0 });
    }
  );

  it("records actual usage and model metadata, releasing unused reservation once", async () => {
    const job = await claim();
    await reserve(job);
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 1,
      chargedTokens: 4_000,
      reservedCalls: 1,
    });
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "succeeded",
      acceptedClaims: 0,
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      responseModelId: "resolved-model",
      provider: "test",
    });
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "failed",
      usage: { totalTokens: 1 },
    });
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 1,
      chargedTokens: 150,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      reservedCalls: 0,
      unknownCalls: 0,
      succeededCalls: 1,
      failedCalls: 0,
      emptyCalls: 1,
      emptyTokens: 150,
      retryCalls: 0,
    });
    expect(await database.select().from(schema.memoryModelUsage)).toMatchObject(
      [
        {
          modelId: "test-model",
          responseModelId: "resolved-model",
          provider: "test",
          status: "reported",
        },
      ]
    );
    await expect(reserve(job)).rejects.toThrow("already reserved");
  });

  it("does not refund unknown, partial, or invalid provider usage", async () => {
    const job = await claim();
    await reserve(job);
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "failed",
      usage: { inputTokens: 80, outputTokens: Number.NaN, totalTokens: -1 },
    });
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      chargedTokens: 4_000,
      inputTokens: 80,
      unknownTokens: 4_000,
      unknownCalls: 1,
      failedCalls: 1,
    });
  });

  it("charges known overruns and refuses subsequent extraction", async () => {
    const job = await claim();
    await reserve(job);
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "succeeded",
      usage: { inputTokens: 10_000, outputTokens: 50, totalTokens: 10_050 },
    });
    const next = await secondScope();
    await expect(reserve(next, 1, "second-key")).rejects.toBeInstanceOf(
      MemoryBudgetExceededError
    );
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      chargedTokens: 10_050,
      remainingTokens: 0,
      calls: 1,
    });
  });

  it("uses component totals when the provider omits or underreports total usage", async () => {
    const job = await claim();
    await reserve(job);
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "succeeded",
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 10 },
    });
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      chargedTokens: 150,
      totalTokens: 10,
      unknownCalls: 0,
    });
  });

  it("serializes concurrent reservations across scope keys in one workspace", async () => {
    limits.tokens = 5_000;
    const [first, second] = await Promise.all([claim(), secondScope()]);
    const results = await Promise.allSettled([
      reserve(first),
      reserve(second, 4_000, "second-key"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 1,
      chargedTokens: 4_000,
    });
  });

  it("enforces the call allowance independently of tokens and zero pauses extraction", async () => {
    limits.calls = 1;
    const first = await claim();
    await reserve(first, 1);
    await completeMemoryModelUsage(scope, scopeKey, first, {
      outcome: "succeeded",
      usage: { totalTokens: 0 },
    });
    const second = await secondScope();
    await expect(reserve(second, 1, "second-key")).rejects.toBeInstanceOf(
      MemoryBudgetExceededError
    );
    limits.calls = 0;
    await expect(reserve(second, 1, "second-key")).rejects.toBeInstanceOf(
      MemoryBudgetExceededError
    );
    limits.calls = 10;
    limits.tokens = 0;
    await expect(reserve(second, 1, "second-key")).rejects.toBeInstanceOf(
      MemoryBudgetExceededError
    );
  });

  it("retains an abandoned reservation through retry and starts a fresh UTC allowance", async () => {
    const first = await claim();
    await reserve(first);
    await releaseMemoryJob(scope, scopeKey, first.id, first.leaseToken);
    await database
      .update(schema.memoryJobs)
      .set({ availableAt: new Date(0) })
      .where(eq(schema.memoryJobs.id, first.id));
    const next = await claimMemoryJob(scope, scopeKey, first.id);
    if (!next) throw new Error("Expected retry.");
    await reserve(next);
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      calls: 2,
      reservedCalls: 2,
      chargedTokens: 8_000,
      retryCalls: 1,
      retryTokens: 4_000,
    });
    await database.update(schema.memoryModelUsage).set({ day: "2026-10-20" });
    const other = await secondScope();
    await reserve(other, 4_000, "second-key");
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      day: today,
      calls: 1,
      chargedTokens: 4_000,
    });
    expect(await readMemoryModelUsage(scope, "2026-10-20")).toMatchObject({
      calls: 2,
      chargedTokens: 8_000,
    });
  });

  it("rejects invalid, stale, or cross-workspace leases before reservation", async () => {
    const job = await claim();
    await expect(
      reserve({ ...job, leaseToken: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow("lease");
    await expect(
      reserveMemoryModelUsage(
        { userId: "mallory", workspaceId: scope.workspaceId },
        scopeKey,
        job,
        { modelId: "test", reservedTokens: 1 }
      )
    ).rejects.toThrow("access");
    await database
      .update(schema.memoryJobs)
      .set({ leaseExpiresAt: new Date(0) });
    await expect(reserve(job)).rejects.toThrow("lease");
    expect(await readMemoryModelUsage(scope)).toMatchObject({ calls: 0 });
    await expect(
      readMemoryModelUsage({ ...scope, userId: "mallory" })
    ).rejects.toThrow("access");
  });

  it("settles a completed provider call even when the job lease subsequently expires", async () => {
    const job = await claim();
    await reserve(job);
    await database
      .update(schema.memoryJobs)
      .set({ leaseExpiresAt: new Date(0) });
    await completeMemoryModelUsage(scope, scopeKey, job, {
      outcome: "succeeded",
      usage: { totalTokens: 90 },
    });
    expect(await readMemoryModelUsage(scope)).toMatchObject({
      chargedTokens: 90,
    });
  });

  it("releases a budget-deferred lease when its source was saved explicitly meanwhile", async () => {
    limits.tokens = 0;
    const job = await claim();
    await expect(reserve(job)).rejects.toBeInstanceOf(
      MemoryBudgetExceededError
    );
    const body = "I prefer quiet trains.";
    await saveMemoryRecord(
      scope,
      scopeKey,
      {
        id: "explicit",
        expectedRevision: 0,
        content: {
          kind: "preference",
          title: "Trains",
          body,
          evidence: [{ sourceId: "source", start: 0, end: body.length }],
        },
      },
      "explicit-save",
      { sourceId: "source" }
    );
    const retryAt = new Date(Date.now() + 86_400_000);
    await deferMemoryJob(scope, scopeKey, job.id, job.leaseToken, retryAt);
    expect(await readMemorySource(scope, scopeKey, "source")).toMatchObject({
      status: "processed",
      text: body,
    });
    expect(
      await database
        .select()
        .from(schema.memoryJobs)
        .where(eq(schema.memoryJobs.id, job.id))
    ).toMatchObject([
      { status: "pending", attempts: 0, leaseToken: null, sourceVersions: [] },
    ]);
    const [ready] = await listReadyMemoryJobs();
    if (!ready)
      throw new Error(
        "Expected the concurrent explicit export to remain ready."
      );
    const exported = await claimMemoryJob(scope, scopeKey, ready.id);
    expect(exported?.exportRecords.map((record) => record.id)).toEqual([
      "explicit",
    ]);
    expect(exported?.sources).toEqual([]);
    expect(await readMemoryModelUsage(scope)).toMatchObject({ calls: 0 });
  });

  it("defers without consuming attempts and wakes existing exports without a model call", async () => {
    limits.tokens = 0;
    const job = await claim();
    const retryAt = new Date(
      new Date(`${today}T00:00:00.000Z`).getTime() + 86_400_000
    );
    await expect(reserve(job)).rejects.toMatchObject({ retryAt });
    await deferMemoryJob(scope, scopeKey, job.id, job.leaseToken, retryAt);
    expect(await listReadyMemoryJobs()).toEqual([]);
    expect(await database.select().from(schema.memoryJobs)).toMatchObject([
      { attempts: 0, checkpoint: null, status: "pending" },
    ]);
    await editMemoryRecord(
      scope,
      scopeKey,
      {
        id: "explicit",
        expectedRevision: 0,
        kind: "preference",
        title: "Trains",
        body: "I prefer quiet trains.",
      },
      "save"
    );
    const [ready] = await listReadyMemoryJobs();
    if (!ready)
      throw new Error("Expected explicit export to wake maintenance.");
    const exported = await claimMemoryJob(scope, scopeKey, ready.id);
    if (!exported) throw new Error("Expected export job.");
    expect(exported.sources).toEqual([]);
    expect(exported.sourceVersions).toEqual([]);
    expect(exported.exportRecords).toHaveLength(1);
    await checkpointMemoryJob(
      scope,
      scopeKey,
      exported.id,
      exported.leaseToken,
      { records: [], links: [] }
    );
    await publishMemoryJob(scope, scopeKey, {
      jobId: exported.id,
      leaseToken: exported.leaseToken,
      expectedEpoch: exported.epoch,
      records: [],
      links: [],
    });
    expect(
      await database
        .select()
        .from(schema.memorySources)
        .where(eq(schema.memorySources.id, "source"))
    ).toMatchObject([{ status: "pending", text: "I prefer quiet trains." }]);
    await forgetMemoryRecord(
      scope,
      scopeKey,
      { id: "explicit", expectedRevision: 1 },
      "forget"
    );
    expect(await readMemoryModelUsage(scope)).toMatchObject({ calls: 0 });
  });
});

/* oxlint-disable eslint/no-await-in-loop -- These fixtures exercise ordered transactions and their subsequent results. */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { fileMemory, inMemory } from "eve/memory/file";
import type { MemoryTurnStartedContext } from "eve/memory";
import { withProfileMemoryMigration } from "@agent/lib/memory/legacy";
import * as MemoryConfiguration from "@shared/memory/config";
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
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import {
  claimMemoryBlobPurge,
  completeMemoryBlobPurge,
  listPendingMemoryBlobPurges,
  registerMemoryJobArtifacts,
} from "@db/services/memory/artifacts";
import {
  readMemoryGeneration,
  readMemoryRecall,
  saveMemoryRecall,
} from "@db/services/memory/generations";
import {
  checkpointMemoryJob,
  claimMemoryJob,
  listReadyMemoryJobs,
  publishMemoryJob,
  releaseMemoryJob,
} from "@db/services/memory/jobs";
import {
  importLegacyMemory,
  readLegacyMemoryImport,
} from "@db/services/memory/legacy";
import {
  editMemoryRecord,
  exportMemoryRecords,
  findMemoryRecords,
  followMemoryLinks,
  forgetMemoryRecord,
  memoryRecordHistory,
  readMemoryRecord,
  saveMemoryRecord,
} from "@db/services/memory/records";
import {
  listMemoryBindings,
  listMemorySessionBindings,
  readMemoryBinding,
  readMemoryState,
  registerMemoryScope,
  setMemoryCaptureDisabled,
} from "@db/services/memory/scope";
import {
  captureMemorySource,
  discardUnusedMemoryTurnInputs,
  readMemorySource,
  recordMemoryRecovery,
} from "@db/services/memory/sources";
import {
  memoryProposalSchema,
  type MemorySourceInput,
} from "@shared/memory/schema";

const client = new PGlite();
const database = drizzle(client, { schema });
const alice = { userId: "alice", workspaceId: "workspace-alice" };
const bob = { userId: "bob", workspaceId: "workspace-bob" };
const key = "knowledge-production";
const initial = {
  id: "seat",
  expectedRevision: 0,
  kind: "preference",
  title: "Seat",
  body: "I prefer window seats.",
} as const;

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the Drizzle service contract using an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise production queries with the test driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
  await database.delete(schema.memoryArtifacts);
  await database.delete(schema.workspaces);
  for (const scope of [alice, bob]) {
    await ensureScope(scope);
    await database.insert(schema.agentSessions).values({
      sessionId: scope.userId,
      workspaceId: scope.workspaceId,
      createdByUserId: scope.userId,
    });
    await registerMemoryScope(scope, key, "production-knowledge", scope.userId);
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function source(
  id: string,
  text: string = initial.body,
  observedAt = new Date().toISOString()
): MemorySourceInput {
  return {
    id,
    kind: "user",
    text,
    reference: `session:alice:turn:${id}`,
    sessionId: "alice",
    turnId: id,
    observedAt,
  };
}
function proposal(
  sourceId: string,
  body: string = initial.body,
  id = "seat",
  expectedRevision = 0
) {
  return memoryProposalSchema.parse({
    records: [
      {
        id,
        expectedRevision,
        content: {
          kind: "preference",
          title: "Seat",
          body,
          evidence: [{ sourceId, start: 0, end: body.length }],
        },
      },
    ],
  });
}
async function claim() {
  const [ready] = await listReadyMemoryJobs(10, [alice.workspaceId]);
  if (!ready) throw new Error("Expected queued maintenance.");
  const result = await claimMemoryJob(alice, key, ready.id);
  if (!result) throw new Error("Expected claimable maintenance.");
  return result;
}
function artifact(
  job: Awaited<ReturnType<typeof claim>>,
  recordId = "seat",
  revision = 1
) {
  return {
    pathname: `memory/${job.id}/${job.leaseToken}/${recordId}.md`,
    sha256: "a".repeat(64),
    recordId,
    revision,
  };
}

describe("knowledge memory storage", () => {
  it("applies immediate corrections, exact retries and revision conflicts", async () => {
    const first = await editMemoryRecord(alice, key, initial, "edit-1");
    expect(await editMemoryRecord(alice, key, initial, "edit-1")).toEqual(
      first
    );
    expect(await memoryRecordHistory(alice, key, "seat")).toHaveLength(1);
    const [successful, conflict] = await Promise.allSettled([
      editMemoryRecord(
        alice,
        key,
        { ...initial, expectedRevision: 1, body: "I prefer aisle seats." },
        "edit-2"
      ),
      editMemoryRecord(
        alice,
        key,
        { ...initial, expectedRevision: 1, body: "I prefer quiet seats." },
        "edit-3"
      ),
    ]);
    expect([successful.status, conflict.status].toSorted()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await readMemoryRecord(alice, key, "seat")).toMatchObject({
      revision: 2,
      explicit: true,
    });
    await expect(
      editMemoryRecord(alice, key, { ...initial, body: "Different" }, "edit-1")
    ).rejects.toThrow(/identity|changed|excluded|evidence/u);
    expect((await readMemoryGeneration(alice, key)).profile).toContain(
      "seats."
    );
  });

  it("isolates workspaces and namespaces, and never recreates revoked membership", async () => {
    expect(
      await listMemoryBindings({ userId: "fresh", workspaceId: "fresh" })
    ).toEqual([]);
    await editMemoryRecord(alice, key, initial, "save");
    expect(await readMemoryRecord(bob, key, "seat")).toBeNull();
    expect((await findMemoryRecords(alice, "preview")).items).toEqual([]);
    await expect(
      registerMemoryScope(alice, "preview", "preview", "alice")
    ).rejects.toThrow("another scope");
    expect(await readMemoryBinding(bob, "alice")).toBeNull();
    await database
      .delete(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.userId, alice.userId));
    await expect(readMemoryRecord(alice, key, "seat")).rejects.toThrow(
      "access"
    );
    await expect(editMemoryRecord(alice, key, initial, "late")).rejects.toThrow(
      "access"
    );
    expect(await listReadyMemoryJobs(10, [alice.workspaceId])).toEqual([]);
    expect(await listMemoryBindings(alice)).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.userId, alice.userId))
    ).toEqual([]);
  });

  it("captures once, validates identities and excludes secrets and opted out text at storage", async () => {
    const input = source("one");
    await captureMemorySource(alice, key, input);
    await captureMemorySource(alice, key, input);
    expect(await database.select().from(schema.memorySources)).toHaveLength(1);
    expect(
      await captureMemorySource(
        alice,
        key,
        source("before-activation", initial.body, new Date(0).toISOString())
      )
    ).toMatchObject({ status: "excluded", text: null });
    await expect(
      captureMemorySource(alice, key, { ...input, text: "Changed" })
    ).rejects.toThrow("identity");
    for (const [index, text] of [
      "My password is hunter2",
      "482193",
      "Never save this preference",
      "sk_abcdefghijklmnopqrstuvwxyz",
    ].entries()) {
      const id = `secret-${String(index)}`;
      expect(
        await captureMemorySource(alice, key, source(id, text))
      ).toMatchObject({ text: null, reference: null, status: "excluded" });
      await expect(
        editMemoryRecord(
          alice,
          key,
          { ...initial, id, body: text },
          `edit-${String(index)}`
        )
      ).rejects.toThrow(/identity|changed|excluded|evidence/u);
    }
    expect(await readMemorySource(alice, key, "secret-0")).toBeNull();
  });

  it("commits recovery input and cursor together, filters bindings before limiting, and disables sensitive sessions", async () => {
    expect(
      (await listMemorySessionBindings(1, [bob.workspaceId])).map(
        (binding) => binding.userId
      )
    ).toEqual(["bob"]);
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 0,
      nextCursor: 10,
      sources: [source("recovered")],
    });
    await expect(
      recordMemoryRecovery(alice, key, "alice", {
        expectedCursor: 0,
        nextCursor: 20,
        sources: [source("bad-cursor")],
      })
    ).rejects.toThrow("cursor");
    expect(await readMemorySource(alice, key, "bad-cursor")).toBeNull();
    const job = await claim();
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 10,
      nextCursor: 30,
      captureBoundaries: [
        { turnId: "recovered", observedAt: new Date().toISOString() },
      ],
      sources: [source("sensitive-reply")],
    });
    expect(await readMemoryBinding(alice, "alice")).toMatchObject({
      cursor: 30,
      captureDisabled: true,
    });
    expect(await readMemorySource(alice, key, "recovered")).toBeNull();
    expect(await readMemorySource(alice, key, "sensitive-reply")).toBeNull();
    await expect(
      publishMemoryJob(alice, key, {
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
        ...proposal("recovered"),
      })
    ).rejects.toThrow("lease");
    await expect(
      editMemoryRecord(alice, key, initial, "editor-after-disable")
    ).resolves.toMatchObject({ explicit: true });
  });

  it("applies an earlier recovered boundary after capture was already disabled", async () => {
    const start = Date.now() + 1_000;
    const observedAt = (offset: number) =>
      new Date(start + offset).toISOString();
    await captureMemorySource(
      alice,
      key,
      source("unrelated", "I prefer quiet cars.", observedAt(0))
    );
    await captureMemorySource(
      alice,
      key,
      source("earlier-question", "I prefer old context.", observedAt(1_000))
    );
    await captureMemorySource(
      alice,
      key,
      source("later-question", "I prefer new context.", observedAt(3_000))
    );
    await setMemoryCaptureDisabled(alice, key, "alice", {
      turnId: "later-question",
      observedAt: observedAt(4_000),
    });
    expect(
      await readMemorySource(alice, key, "earlier-question")
    ).not.toBeNull();
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 0,
      nextCursor: 10,
      captureBoundaries: [
        { turnId: "earlier-question", observedAt: observedAt(2_000) },
      ],
      sources: [source("late-insert", "I prefer forgotten context.")],
    });
    expect(await readMemorySource(alice, key, "unrelated")).not.toBeNull();
    expect(await readMemorySource(alice, key, "earlier-question")).toBeNull();
    expect(await readMemorySource(alice, key, "later-question")).toBeNull();
    expect(await readMemorySource(alice, key, "late-insert")).toBeNull();
  });

  it("discards unsupported control text while retaining pending inputs and saved revision evidence", async () => {
    await captureMemorySource(alice, key, source("history"));
    const first = proposal("history").records[0];
    if (!first) throw new Error("Expected record.");
    await saveMemoryRecord(alice, key, first, "first", { sourceId: "history" });
    await captureMemorySource(
      alice,
      key,
      source("current", "I prefer aisle seats.")
    );
    const replacement = proposal("current", "I prefer aisle seats.", "seat", 1)
      .records[0];
    if (!replacement) throw new Error("Expected replacement.");
    await saveMemoryRecord(alice, key, replacement, "replacement", {
      sourceId: "current",
    });
    await captureMemorySource(alice, key, {
      ...source("unused", "Please update the spreadsheet with this context."),
      turnId: "history",
    });
    await captureMemorySource(alice, key, {
      ...source("ordinary", "I prefer quiet trains."),
      turnId: "history",
    });
    await captureMemorySource(
      alice,
      key,
      source("unfinished", "Please update the other spreadsheet.")
    );
    await discardUnusedMemoryTurnInputs(alice, key, "alice", "history");
    expect(await readMemorySource(alice, key, "unused")).toBeNull();
    expect(await readMemorySource(alice, key, "history")).not.toBeNull();
    expect(await readMemorySource(alice, key, "current")).not.toBeNull();
    expect(await readMemorySource(alice, key, "ordinary")).toMatchObject({
      status: "pending",
    });
    expect(await readMemorySource(alice, key, "unfinished")).not.toBeNull();
    const [discarded] = await database
      .select()
      .from(schema.memorySources)
      .where(eq(schema.memorySources.id, "unused"));
    expect(discarded).toMatchObject({
      status: "excluded",
      text: null,
      reference: null,
      sessionId: null,
      turnId: null,
    });
  });

  it("repairs unused control cleanup within and across recovery pages and keeps discarded input tombstones", async () => {
    const input = source("control", "Please update the spreadsheet.");
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 0,
      nextCursor: 1,
      sources: [input],
    });
    expect(await readMemorySource(alice, key, "control")).not.toBeNull();
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 1,
      nextCursor: 2,
      sources: [],
      finishedTurnIds: ["control"],
    });
    expect(await readMemorySource(alice, key, "control")).toBeNull();
    expect(await captureMemorySource(alice, key, input)).toMatchObject({
      text: null,
      status: "excluded",
    });
    await recordMemoryRecovery(alice, key, "alice", {
      expectedCursor: 2,
      nextCursor: 4,
      sources: [source("same-page", "Please update another spreadsheet.")],
      finishedTurnIds: ["same-page"],
    });
    expect(await readMemorySource(alice, key, "same-page")).toBeNull();
  });

  it("leases one input, checkpoints, atomically publishes supported records and exports, then deduplicates completion", async () => {
    await captureMemorySource(alice, key, source("one"));
    await captureMemorySource(
      alice,
      key,
      source("two", "I prefer early flights.")
    );
    const job = await claim();
    expect(job.sources).toHaveLength(1);
    const sourceId = job.sources[0]?.id;
    if (!sourceId) throw new Error("Expected captured source.");
    const proposed = proposal(sourceId);
    await checkpointMemoryJob(alice, key, job.id, job.leaseToken, proposed);
    expect(await claimMemoryJob(alice, key, job.id)).toBeNull();
    const file = artifact(job);
    await registerMemoryJobArtifacts(alice, key, job.id, job.leaseToken, [
      file,
    ]);
    const input = {
      ...proposed,
      jobId: job.id,
      leaseToken: job.leaseToken,
      expectedEpoch: job.epoch,
      artifacts: [file],
    };
    const generation = await publishMemoryJob(alice, key, input);
    expect(await publishMemoryJob(alice, key, input)).toEqual(generation);
    expect(await readMemoryRecord(alice, key, "seat")).toMatchObject({
      revision: 1,
      explicit: false,
    });
    expect((await claim()).sources.map((entry) => entry.id)).toEqual(["two"]);
    expect(await claimMemoryBlobPurge(alice, key, file.pathname)).toBeNull();
  });

  it("rejects invented claims, out-of-claim evidence and autonomous overwrite of explicit correction", async () => {
    await editMemoryRecord(alice, key, initial, "explicit");
    const exported = await claim();
    const file = artifact(exported);
    await registerMemoryJobArtifacts(
      alice,
      key,
      exported.id,
      exported.leaseToken,
      [file]
    );
    await publishMemoryJob(alice, key, {
      jobId: exported.id,
      leaseToken: exported.leaseToken,
      expectedEpoch: exported.epoch,
      records: [],
      links: [],
      artifacts: [file],
    });
    await captureMemorySource(
      alice,
      key,
      source("new", "I prefer aisle seats.")
    );
    const job = await claim();
    await expect(
      publishMemoryJob(alice, key, {
        ...proposal("new", "I prefer aisle seats.", "seat", 1),
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
      })
    ).rejects.toThrow("explicit correction");
    await expect(
      publishMemoryJob(alice, key, {
        ...proposal("new", "Invented fact", "invented"),
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
      })
    ).rejects.toThrow("exact supporting");
    expect(await readMemoryRecord(alice, key, "invented")).toBeNull();
    expect((await readMemoryRecord(alice, key, "seat"))?.content.body).toBe(
      initial.body
    );
  });

  it("queues export-only work for explicit edits and fences abandoned artifacts from publication", async () => {
    await editMemoryRecord(alice, key, initial, "explicit");
    const job = await claim();
    expect(job.sources).toEqual([]);
    expect(job.exportRecords).toMatchObject([{ id: "seat", revision: 1 }]);
    const file = artifact(job);
    await registerMemoryJobArtifacts(alice, key, job.id, job.leaseToken, [
      file,
    ]);
    await releaseMemoryJob(alice, key, job.id, job.leaseToken);
    expect(await claimMemoryBlobPurge(alice, key, file.pathname)).toBeNull();
    await database
      .update(schema.memoryArtifacts)
      .set({ createdAt: new Date(Date.now() - 6 * 60_000) });
    expect(await claimMemoryBlobPurge(alice, key, file.pathname)).toMatchObject(
      { pathname: file.pathname }
    );
    await expect(
      publishMemoryJob(alice, key, {
        records: [],
        links: [],
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
        artifacts: [file],
      })
    ).rejects.toThrow("lease");
    await completeMemoryBlobPurge(alice, key, file.pathname);
    expect(await database.select().from(schema.memoryArtifacts)).toEqual([]);
  });

  it("purges original and corrected sources, history, caches and snapshots and fences late recovered facts", async () => {
    const observedAt = new Date().toISOString();
    await editMemoryRecord(alice, key, initial, "original");
    const cache = {
      messages: [{ id: "knowledge-profile", content: initial.body }],
    };
    await saveMemoryRecall(alice, key, "recall", 0, cache);
    await editMemoryRecord(
      alice,
      key,
      { ...initial, expectedRevision: 1, body: "I prefer aisle seats." },
      "correction"
    );
    expect(
      await saveMemoryRecall(alice, key, "recall", 0, { messages: [] })
    ).toEqual(cache);
    await captureMemorySource(
      alice,
      key,
      source("pending", "I enjoy travel.", observedAt)
    );
    const job = await claim();
    await checkpointMemoryJob(
      alice,
      key,
      job.id,
      job.leaseToken,
      proposal("pending", "I enjoy travel.", "travel")
    );
    await forgetMemoryRecord(
      alice,
      key,
      { id: "seat", expectedRevision: 2 },
      "forget"
    );
    expect(await readMemoryRecord(alice, key, "seat")).toBeNull();
    expect(await memoryRecordHistory(alice, key, "seat")).toEqual([]);
    expect(
      (await database.select().from(schema.memorySources)).every(
        (entry) => entry.text === null && entry.reference === null
      )
    ).toBe(true);
    expect(
      (await database.select().from(schema.memoryGenerations)).every(
        (entry) => !entry.profile.includes("seats")
      )
    ).toBe(true);
    expect(
      await database.select().from(schema.memoryRecallResults)
    ).toMatchObject([{ result: null, invalidated: true }]);
    await expect(readMemoryRecall(alice, key, "recall")).rejects.toThrow(
      "Start a new turn"
    );
    await expect(
      saveMemoryRecall(alice, key, "recall", 1, { messages: [] })
    ).rejects.toThrow("Start a new turn");
    await expect(
      editMemoryRecord(alice, key, initial, "delayed")
    ).rejects.toThrow("forgotten");
    expect(
      await captureMemorySource(
        alice,
        key,
        source("previously-missed", initial.body, observedAt)
      )
    ).toMatchObject({ text: null, status: "excluded" });
    expect((await exportMemoryRecords(alice, key)).records).toEqual([]);
    await expect(
      editMemoryRecord(
        alice,
        key,
        { ...initial, id: "new-seat" },
        "intentional-new-memory"
      )
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("purges all records sharing a forgotten source, including sources from older revisions", async () => {
    const text = "I prefer trains. I prefer window seats.";
    await captureMemorySource(alice, key, source("shared", text));
    const job = await claim();
    const records = [
      {
        id: "train",
        expectedRevision: 0,
        content: {
          kind: "preference",
          title: "Travel",
          body: "I prefer trains.",
          evidence: [{ sourceId: "shared", start: 0, end: 16 }],
        },
      },
      {
        id: "seat",
        expectedRevision: 0,
        content: {
          kind: "preference",
          title: "Seat",
          body: initial.body,
          evidence: [{ sourceId: "shared", start: 17, end: text.length }],
        },
      },
    ];
    const files = [artifact(job, "train"), artifact(job, "seat")];
    await registerMemoryJobArtifacts(alice, key, job.id, job.leaseToken, files);
    await expect(
      publishMemoryJob(alice, key, {
        ...memoryProposalSchema.parse({
          records,
          links: [{ fromId: "train", toId: "seat", relation: "employer" }],
        }),
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
      })
    ).rejects.toThrow("co-mentioned");
    await publishMemoryJob(alice, key, {
      ...memoryProposalSchema.parse({
        records,
        links: [{ fromId: "train", toId: "seat", relation: "co-mentioned" }],
      }),
      jobId: job.id,
      leaseToken: job.leaseToken,
      expectedEpoch: job.epoch,
      artifacts: files,
    });
    expect((await followMemoryLinks(alice, key, "seat")).links).toHaveLength(1);
    await editMemoryRecord(
      alice,
      key,
      { ...initial, expectedRevision: 1, body: "I prefer aisle seats." },
      "correction"
    );
    expect((await followMemoryLinks(alice, key, "seat")).links).toEqual([]);
    expect(
      (await database.select().from(schema.memoryArtifacts)).map(
        (file) => file.status
      )
    ).toEqual(["purge", "purge"]);
    const forgotten = await forgetMemoryRecord(
      alice,
      key,
      { id: "seat", expectedRevision: 2 },
      "forget"
    );
    expect(forgotten.recordIds.toSorted()).toEqual(["seat", "train"]);
    expect(await readMemorySource(alice, key, "shared")).toBeNull();
    expect(await database.select().from(schema.memoryRevisions)).toEqual([]);
  });

  it("imports legacy entries once with unknown provenance and a permanent rollback fence", async () => {
    const input = {
      legacyScopeKey: "old-profile",
      entries: [
        { index: 0, text: initial.body },
        { index: 1, text: "OTP 123456" },
      ],
    };
    expect(await importLegacyMemory(alice, key, input)).toMatchObject({
      imported: 1,
    });
    expect(await importLegacyMemory(alice, key, input)).toMatchObject({
      imported: 0,
    });
    const [record] = (await findMemoryRecords(alice, key)).items;
    if (!record) throw new Error("Expected imported record.");
    expect(
      (await readMemoryRecord(alice, key, record.id))?.sources[0]?.reference
    ).toContain("original source and date unknown");
    await forgetMemoryRecord(
      alice,
      key,
      { id: record.id, expectedRevision: 1 },
      "forget-legacy"
    );
    expect(await readLegacyMemoryImport(alice, "old-profile")).toEqual({
      scopeKey: key,
    });
    expect(
      await importLegacyMemory(alice, key, {
        ...input,
        legacyScopeKey: "other-old-profile",
      })
    ).toMatchObject({ imported: 0 });
  });

  it("bounds complete projection rows and handles literal search and expired records", async () => {
    for (let index = 0; index < 4; index += 1)
      await editMemoryRecord(
        alice,
        key,
        {
          ...initial,
          id: `long-${String(index)}`,
          body: `Complete-${String(index)} ${"word ".repeat(500)}END`,
        },
        `long-${String(index)}`
      );
    const generation = await readMemoryGeneration(alice, key);
    expect(generation.profile.length).toBeLessThanOrEqual(6_000);
    expect(generation.recordIds).toHaveLength(2);
    expect(
      generation.profile.split("\n").every((line) => line.endsWith("END"))
    ).toBe(true);
    await editMemoryRecord(
      alice,
      key,
      { ...initial, id: "discount", body: "Discount of 10%_available" },
      "discount"
    );
    expect(
      (await findMemoryRecords(alice, key, { query: "%_" })).items.map(
        (record) => record.id
      )
    ).toEqual(["discount"]);
    expect((await readMemoryState(alice, key)).generation).toBe(5);
  });

  it("removes ignored input content after successful extraction without a claim", async () => {
    await captureMemorySource(
      alice,
      key,
      source("question", "What is the weather today?")
    );
    const job = await claim();
    await publishMemoryJob(alice, key, {
      records: [],
      links: [],
      jobId: job.id,
      leaseToken: job.leaseToken,
      expectedEpoch: job.epoch,
    });
    expect(await readMemorySource(alice, key, "question")).toBeNull();
    expect(await database.select().from(schema.memorySources)).toMatchObject([
      { id: "question", text: null, reference: null, status: "excluded" },
    ]);
    expect(
      await captureMemorySource(
        alice,
        key,
        source("question", "What is the weather today?")
      )
    ).toMatchObject({ text: null });
  });

  it("retains cleanup ledger across revocation and workspace deletion without recreating membership", async () => {
    await editMemoryRecord(alice, key, initial, "explicit");
    const job = await claim();
    const file = artifact(job);
    await registerMemoryJobArtifacts(alice, key, job.id, job.leaseToken, [
      file,
    ]);
    await publishMemoryJob(alice, key, {
      records: [],
      links: [],
      jobId: job.id,
      leaseToken: job.leaseToken,
      expectedEpoch: job.epoch,
      artifacts: [file],
    });
    await database
      .update(schema.memoryArtifacts)
      .set({ createdAt: new Date(Date.now() - 6 * 60_000) });
    await database
      .delete(schema.workspaceMemberships)
      .where(eq(schema.workspaceMemberships.userId, alice.userId));
    expect(await listPendingMemoryBlobPurges()).toMatchObject([
      { pathname: file.pathname },
    ]);
    await database
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, alice.workspaceId));
    expect(await database.select().from(schema.memoryArtifacts)).toHaveLength(
      1
    );
    expect(
      await claimMemoryBlobPurge(alice, key, file.pathname)
    ).not.toBeNull();
    await completeMemoryBlobPurge(alice, key, file.pathname);
    expect(await database.select().from(schema.memoryArtifacts)).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.memoryState)
        .where(eq(schema.memoryState.workspaceId, alice.workspaceId))
    ).toEqual([]);
  });

  it("ranks bounded lexical query terms and exact aliases across complete questions", async () => {
    await editMemoryRecord(
      alice,
      key,
      {
        ...initial,
        id: "flights",
        title: "Flights",
        body: "I prefer early flights.",
        aliases: ["air travel"],
      },
      "flights"
    );
    await editMemoryRecord(
      alice,
      key,
      {
        ...initial,
        id: "rail",
        title: "Trains",
        body: "I take trains in winter.",
      },
      "rail"
    );
    expect(
      (
        await findMemoryRecords(alice, key, {
          query: "What do you know about early flights?",
        })
      ).items.map((row) => row.id)
    ).toEqual(["flights"]);
    expect(
      (await findMemoryRecords(alice, key, { query: "air travel" })).items[0]
        ?.id
    ).toBe("flights");
    expect(
      (await findMemoryRecords(bob, key, { query: "early flights" })).items
    ).toEqual([]);
  });

  it("rolls back all proposals when later evidence fails and rejects expired lease tokens", async () => {
    await captureMemorySource(alice, key, source("one"));
    const job = await claim();
    const valid = proposal("one");
    const invalid = proposal("one", "An invented fact.", "invented");
    await expect(
      publishMemoryJob(alice, key, {
        records: [...valid.records, ...invalid.records],
        links: [],
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
      })
    ).rejects.toThrow("exact supporting");
    expect(await database.select().from(schema.memoryRecords)).toEqual([]);
    expect(await database.select().from(schema.memoryRevisions)).toEqual([]);
    await editMemoryRecord(
      alice,
      key,
      { ...initial, id: "neighbor" },
      "neighbor"
    );
    await expect(
      publishMemoryJob(alice, key, {
        ...valid,
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
        expectedGeneration: 0,
      })
    ).rejects.toThrow("linked snapshots");
    await checkpointMemoryJob(alice, key, job.id, job.leaseToken, valid);
    const next = await claimMemoryJob(alice, key, job.id, {
      now: new Date(Date.now() + 180_000),
    });
    expect(next?.leaseToken).not.toBe(job.leaseToken);
    expect(next?.checkpoint).toEqual(valid);
    await expect(
      publishMemoryJob(alice, key, {
        ...valid,
        jobId: job.id,
        leaseToken: job.leaseToken,
        expectedEpoch: job.epoch,
      })
    ).rejects.toThrow("lease");
  });

  it("keeps explicit command evidence out of extraction and removes unconsumed commands on forgetting", async () => {
    await editMemoryRecord(alice, key, initial, "saved");
    const command = source("control", "Remember that I prefer quiet seats.");
    expect(await captureMemorySource(alice, key, command)).toMatchObject({
      status: "processed",
      text: command.text,
    });
    expect((await claim()).sources).toEqual([]);
    await forgetMemoryRecord(
      alice,
      key,
      { id: "seat", expectedRevision: 1 },
      "forget"
    );
    expect(await readMemorySource(alice, key, "control")).toBeNull();
    expect((await exportMemoryRecords(alice, key)).sources).toEqual([]);
  });

  it("imports more than one hundred valid legacy entries without dropping data", async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      index,
      text: `Fact ${String(index)}`,
    }));
    expect(
      await importLegacyMemory(alice, key, {
        legacyScopeKey: "many-entries",
        entries,
      })
    ).toMatchObject({ imported: 101 });
    expect((await exportMemoryRecords(alice, key)).records).toHaveLength(101);
  });

  it("serializes a legacy write already in flight before migration snapshots and clears the file", async () => {
    const mode = vi
      .spyOn(MemoryConfiguration, "knowledgeMemoryModeForWorkspace")
      .mockReturnValue("off");
    const context = legacyContext();
    const backend = inMemory();
    await backend.write({
      key: "legacy-race",
      expectedVersion: null,
      content:
        "<!-- eve-memory-file-v1 lastAllocatedIndex=0 -->\n0: I prefer trains.\n",
      signal: context.abortSignal,
    });
    const provider = withProfileMemoryMigration(
      fileMemory({ backend }),
      backend
    );
    const tools = await provider.tools({
      ...context,
      model: null,
      channel: {},
    });
    if (!tools?.save_memory) throw new Error("Expected legacy save tool.");
    const started = Promise.withResolvers<undefined>();
    const proceed = Promise.withResolvers<undefined>();
    const originalWrite = backend.write.bind(backend);
    const write = vi
      .spyOn(backend, "write")
      .mockImplementation(async (input) => {
        if (input.content.includes("quiet")) {
          started.resolve(undefined);
          await proceed.promise;
        }
        return originalWrite(input);
      });
    try {
      // SAFETY: fileMemory erases tool input types; this is its documented save_memory payload.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise the actual built-in provider through its erased interface.
      const input = { text: "I prefer quiet cars." } as never;
      const saving = tools.save_memory.execute(input, {
        ...context,
        callId: "legacy-save",
        toolName: "profile__save_memory",
        getToken: async () => {
          throw new Error("No token required.");
        },
        requireAuth: () => {
          throw new Error("No auth transition required.");
        },
      });
      await started.promise;
      mode.mockReturnValue("enabled");
      const migrating = provider.recall["turn.started"](context);
      proceed.resolve(undefined);
      await Promise.all([saving, migrating]);
      expect(
        (await exportMemoryRecords(alice, key)).records
          .map((record) => record.content.body)
          .toSorted()
      ).toEqual(["I prefer quiet cars.", "I prefer trains."]);
      expect(
        (
          await backend.read({
            key: "legacy-race",
            signal: context.abortSignal,
          })
        )?.content
      ).toBe("<!-- eve-memory-file-v1 lastAllocatedIndex=1 -->\n");
    } finally {
      proceed.resolve(undefined);
      write.mockRestore();
      mode.mockRestore();
    }
  });

  it("requires exact direct user source for explicit controls", async () => {
    await captureMemorySource(alice, key, source("direct"));
    const input = proposal("direct").records[0];
    if (!input) throw new Error("Expected record.");
    await expect(
      saveMemoryRecord(alice, key, input, "save", { sourceId: "missing" })
    ).rejects.toThrow("current user's");
    await expect(
      saveMemoryRecord(alice, key, input, "save", { sourceId: "direct" })
    ).resolves.toMatchObject({ explicit: true });
    await setMemoryCaptureDisabled(alice, key, "alice", {
      turnId: "direct",
      observedAt: new Date().toISOString(),
    });
    expect(await readMemoryRecord(alice, key, "seat")).toBeNull();
  });
});

function legacyContext() {
  return {
    abortSignal: new AbortController().signal,
    async getSandbox() {
      throw new Error("Memory does not use a sandbox.");
    },
    memory: {
      scope: {
        key: "legacy-race",
        namespace: "profile",
        value: alice.workspaceId,
      },
      slot: "profile",
    },
    messages: [],
    operationId: "legacy-recall",
    session: {
      id: "alice",
      turn: { id: "turn", sequence: 0 },
      auth: {
        initiator: null,
        current: {
          attributes: { workspaceId: alice.workspaceId },
          authenticator: "authjs",
          principalId: alice.userId,
          principalType: "user",
        },
      },
    },
    turn: { id: "turn", input: [], sequence: 0 },
  } satisfies MemoryTurnStartedContext;
}

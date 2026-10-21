/* oxlint-disable eslint/no-await-in-loop -- Scenario actions and repeated runs exercise ordered state transitions. */
import type * as AI from "ai";
import type * as Environment from "@shared/environment";
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
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
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
import { importLegacyMemory } from "@db/services/memory/legacy";
import {
  editMemoryRecord,
  exportMemoryRecords,
  findMemoryRecords,
  followMemoryLinks,
  forgetMemoryRecord,
  memoryRecordHistory,
  readMemoryRecord,
} from "@db/services/memory/records";
import {
  readMemoryState,
  registerMemoryScope,
  setMemoryCaptureDisabled,
} from "@db/services/memory/scope";
import {
  captureMemorySource,
  listMemorySources,
  readMemorySource,
  recordMemoryRecovery,
} from "@db/services/memory/sources";
import {
  captureKnowledgeInput,
  directKnowledgeInputs,
  knowledgeInputSource,
} from "@agent/lib/memory/ingest";
import {
  memoryProposalSchema,
  type MemoryProposal,
} from "@shared/memory/schema";
import { memoryScenarios, memoryScenarioRepetitions } from "./scenarios";

const model = vi.hoisted(() => ({
  generate: vi.fn<
    () => Promise<{
      output: {
        claims: {
          sourceId: string;
          quote: string;
          kind: "preference";
          replacesId: string | null;
        }[];
      };
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>
  >(),
  put: vi.fn<() => Promise<object>>(),
  recovery: vi.fn<() => Promise<void>>(),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof AI>()),
  generateText: model.generate,
}));
vi.mock("@db/services/settings", () => ({
  getGatewayModel: async () => "fixture-extractor",
}));
vi.mock("@vercel/blob", () => ({
  put: model.put,
  del: vi.fn<() => Promise<void>>(),
}));
vi.mock("@agent/lib/schedules/request", () => ({
  postMemoryRecovery: model.recovery,
}));
vi.mock("@shared/memory/config", () => ({
  knowledgeMemoryModeForWorkspace: () => "enabled",
}));
vi.mock("@shared/environment", async (original) => ({
  ...(await original<typeof Environment>()),
  env: {
    ...(await original<typeof Environment>()).env,
    KNOWLEDGE_MEMORY_MODE: "enabled",
  },
}));
import { maintainKnowledge } from "@agent/lib/memory/maintenance";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "scenario-user", workspaceId: "scenario-workspace" };
const key = "scenario-production";
const body = "I prefer window seats on trains.";
const corrected = "I prefer aisle seats on trains.";
const initial = {
  id: "seat",
  expectedRevision: 0,
  kind: "preference",
  title: "Train seating",
  body,
} as const;

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite provides the same query builder contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PGlite runs the production Drizzle queries against an isolated database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
  vi.clearAllMocks();
  await database.delete(schema.memoryArtifacts);
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  await database.insert(schema.agentSessions).values({
    sessionId: "scenario-chat",
    workspaceId: scope.workspaceId,
    createdByUserId: scope.userId,
  });
  await registerMemoryScope(scope, key, "production", "scenario-chat");
  model.generate.mockResolvedValue({
    output: { claims: [] },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  });
  model.put.mockResolvedValue({});
  model.recovery.mockResolvedValue(undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function source(id = "receipt", text = body) {
  return {
    id,
    kind: "user" as const,
    text,
    reference: `session:scenario-chat:turn:${id}`,
    sessionId: "scenario-chat",
    turnId: id,
    observedAt: new Date().toISOString(),
  };
}
function requiredRecord(value: MemoryProposal) {
  const record = value.records[0];
  if (!record) throw new Error("Expected proposal record.");
  return record;
}
function proposal(
  sourceId = "receipt",
  text = body,
  id = "seat",
  revision = 0
) {
  return memoryProposalSchema.parse({
    records: [
      {
        id,
        expectedRevision: revision,
        content: {
          kind: "preference",
          title: "Train seating",
          body: text,
          evidence: [{ sourceId, start: 0, end: text.length }],
        },
      },
    ],
  });
}
async function claim() {
  const [ready] = await listReadyMemoryJobs(10, [scope.workspaceId]);
  if (!ready) throw new Error("Expected a ready memory job.");
  const job = await claimMemoryJob(scope, key, ready.id);
  if (!job) throw new Error("Expected a claimable memory job.");
  return job;
}
function publish(job: Awaited<ReturnType<typeof claim>>, value = proposal()) {
  return publishMemoryJob(scope, key, {
    ...value,
    jobId: job.id,
    leaseToken: job.leaseToken,
    expectedEpoch: job.epoch,
  });
}
async function automatic(text = body, id = "receipt") {
  const input = source(id, text);
  await captureMemorySource(scope, key, input);
  const job = await claim();
  await publish(job, proposal(id, text));
  return { input, job };
}
async function save() {
  return editMemoryRecord(scope, key, initial, "save");
}
async function correct() {
  return editMemoryRecord(
    scope,
    key,
    { ...initial, body: corrected, expectedRevision: 1 },
    "correct"
  );
}
async function forget() {
  return forgetMemoryRecord(
    scope,
    key,
    { id: "seat", expectedRevision: 1 },
    "forget"
  );
}
function modelClaims(
  claims: {
    sourceId: string;
    quote: string;
    kind: "preference";
    replacesId: string | null;
  }[]
) {
  model.generate.mockResolvedValue({
    output: { claims },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  });
}
async function extracted(text: string, quote = text) {
  const input = source("receipt", text);
  await captureMemorySource(scope, key, input);
  modelClaims([
    { sourceId: input.id, quote, kind: "preference", replacesId: null },
  ]);
  await maintainKnowledge();
  return findMemoryRecords(scope, key);
}

const gates: Record<(typeof memoryScenarios)[number][0], () => Promise<void>> =
  {
    "SEM-01": async () => {
      await save();
      expect((await readMemoryGeneration(scope, key)).profile).toContain(body);
    },
    "SEM-02": async () => {
      await save();
      expect(
        (
          await findMemoryRecords(scope, key, {
            query: "Which seating on trains?",
          })
        ).items.map((record) => record.id)
      ).toEqual(["seat"]);
    },
    "SEM-03": async () => {
      await editMemoryRecord(
        scope,
        key,
        {
          ...initial,
          id: "sam-work",
          kind: "person",
          title: "Sam at work",
          body: "My colleague Sam works at North Lab.",
        },
        "sam-work"
      );
      await editMemoryRecord(
        scope,
        key,
        {
          ...initial,
          id: "sam-family",
          kind: "person",
          title: "Sam in my family",
          body: "My cousin Sam works at South Lab.",
        },
        "sam-family"
      );
      expect(
        (await findMemoryRecords(scope, key, { query: "Sam" })).items
          .map((record) => record.id)
          .toSorted()
      ).toEqual(["sam-family", "sam-work"]);
    },
    "SEM-04": async () => {
      await save();
      expect(
        (
          await findMemoryRecords(scope, key, {
            query: "dietary gluten allergy",
          })
        ).items
      ).toEqual([]);
    },
    "SEM-05": async () => {
      expect(
        (await extracted("For today only, I prefer an aisle seat.")).items
      ).toEqual([]);
    },
    "SEM-06": async () => {
      await save();
      const record = await readMemoryRecord(scope, key, "seat");
      if (!record) throw new Error("Expected saved record.");
      for (const span of record.content.evidence)
        expect(
          record.sources
            .find((input) => input.id === span.sourceId)
            ?.text?.slice(span.start, span.end)
        ).toBe(record.content.body);
    },
    "SEM-07": async () => {
      const text = `${body} I prefer quiet cars.`;
      await captureMemorySource(scope, key, source("receipt", text));
      const job = await claim();
      const value = proposal();
      value.records.push(
        ...proposal("receipt", "I prefer quiet cars.", "quiet").records.map(
          (record) =>
            Object.assign(record, {
              content: {
                ...record.content,
                evidence: [
                  {
                    sourceId: "receipt",
                    start: body.length + 1,
                    end: text.length,
                  },
                ],
              },
            })
        )
      );
      value.links = [
        { fromId: "seat", toId: "quiet", relation: "co-mentioned" },
      ];
      await publish(job, value);
      expect(
        (await followMemoryLinks(scope, key, "seat")).records.map(
          (record) => record.id
        )
      ).toEqual(["quiet"]);
    },
    "SEM-08": async () => {
      await captureMemorySource(scope, key, source());
      const job = await claim();
      const value = proposal();
      requiredRecord(value).content.expiresAt = new Date(
        Date.now() + 60_000
      ).toISOString();
      await publish(job, value);
      expect((await findMemoryRecords(scope, key)).items).toHaveLength(1);
      await database.update(schema.memoryRecords).set({
        content: {
          ...requiredRecord(value).content,
          expiresAt: new Date(0).toISOString(),
        },
      });
      expect((await findMemoryRecords(scope, key)).items).toHaveLength(0);
      expect(
        (await findMemoryRecords(scope, key, { includeHistorical: true })).items
      ).toHaveLength(1);
      expect((await readMemoryGeneration(scope, key)).profile).not.toContain(
        body
      );
    },
    "SRC-01": async () => {
      expect(
        (
          await extracted(
            'My colleague says "I prefer window seats on trains."',
            body
          )
        ).items
      ).toEqual([]);
    },
    "SRC-02": async () => {
      await captureMemorySource(scope, key, {
        ...source(),
        kind: "browser_receipt",
        sessionId: null,
      });
      const job = await claim();
      await expect(publish(job)).rejects.toThrow("user's own statement");
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "SRC-03": async () => {
      expect(
        directKnowledgeInputs([
          { role: "assistant", content: "I booked your train." },
        ])
      ).toEqual([]);
      expect(
        knowledgeInputSource({
          sessionId: "scenario-chat",
          turnId: "background",
          text: "I booked your train.",
          observedAt: new Date().toISOString(),
          kind: "execution.background_task",
        })
      ).toBeNull();
    },
    "SRC-04": async () => {
      await save();
      const recall = await readMemoryGeneration(scope, key);
      expect(
        directKnowledgeInputs([{ role: "assistant", content: recall.profile }])
      ).toEqual([]);
      expect(await listMemorySources(scope, key)).toHaveLength(1);
    },
    "SRC-05": async () => {
      const input = source(
        "private",
        "Do not remember that I prefer window seats."
      );
      await captureMemorySource(scope, key, input);
      await recordMemoryRecovery(scope, key, "scenario-chat", {
        expectedCursor: 0,
        nextCursor: 1,
        sources: [input],
      });
      expect(await readMemorySource(scope, key, input.id)).toBeNull();
      expect((await exportMemoryRecords(scope, key)).sources).toEqual([]);
    },
    "SRC-06": async () => {
      const input = source();
      await captureMemorySource(scope, key, input);
      await setMemoryCaptureDisabled(scope, key, "scenario-chat", {
        turnId: input.turnId,
        observedAt: input.observedAt,
      });
      expect(
        await captureMemorySource(
          scope,
          key,
          source("later", "I prefer quiet cars.")
        )
      ).toMatchObject({ status: "excluded", text: null });
      expect((await exportMemoryRecords(scope, key)).sources).toEqual([]);
    },
    "SRC-07": async () => {
      await save();
      const other = { userId: "other", workspaceId: "other" };
      await ensureScope(other);
      expect(await readMemoryRecord(other, key, "seat")).toBeNull();
      expect((await findMemoryRecords(scope, "preview")).items).toEqual([]);
      await expect(
        readMemoryRecord({ ...scope, userId: "intruder" }, key, "seat")
      ).rejects.toThrow("access");
    },
    "SRC-08": async () => {
      await captureMemorySource(scope, key, source());
      const job = await claim();
      await expect(
        publish(job, proposal("receipt", "I prefer private jets."))
      ).rejects.toThrow(/span|match/u);
      const value = proposal();
      const span = requiredRecord(value).content.evidence[0];
      if (!span) throw new Error("Expected evidence span.");
      span.end += 100;
      await expect(publish(job, value)).rejects.toThrow("span");
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "COR-01": async () => {
      await save();
      await correct();
      const recall = await readMemoryGeneration(scope, key);
      expect(recall.profile).toContain(corrected);
      expect(recall.profile).not.toContain(body);
    },
    "COR-02": async () => {
      await save();
      for (let index = 0; index < 24; index++)
        await editMemoryRecord(
          scope,
          key,
          {
            ...initial,
            id: `other-${String(index)}`,
            title: `Other ${String(index)}`,
            body: `I prefer synthetic option ${String(index)}.`,
          },
          `other-${String(index)}`
        );
      const relevant = (
        await findMemoryRecords(scope, key, { query: "train seating" })
      ).items;
      expect(relevant[0]?.id).toBe("seat");
      await correct();
      expect((await readMemoryRecord(scope, key, "seat"))?.content.body).toBe(
        corrected
      );
    },
    "COR-03": async () => {
      await save();
      await editMemoryRecord(
        scope,
        key,
        {
          ...initial,
          id: "plane",
          title: "Plane seating",
          body: "I prefer window seats on planes.",
        },
        "plane"
      );
      await captureMemorySource(
        scope,
        key,
        source("ambiguous", "I now prefer aisle seats.")
      );
      await maintainKnowledge();
      await maintainKnowledge();
      expect((await readMemoryRecord(scope, key, "seat"))?.revision).toBe(1);
      expect((await readMemoryRecord(scope, key, "plane"))?.revision).toBe(1);
      expect(model.generate).toHaveBeenCalledTimes(1);
    },
    "COR-04": async () => {
      await save();
      await captureMemorySource(scope, key, source("correction", corrected));
      const job = await claim();
      await expect(
        publish(job, proposal("correction", corrected, "seat", 1))
      ).rejects.toThrow("explicit");
      expect((await readMemoryRecord(scope, key, "seat"))?.content.body).toBe(
        body
      );
    },
    "COR-05": async () => {
      await save();
      await correct();
      await expect(
        editMemoryRecord(
          scope,
          key,
          { ...initial, expectedRevision: 1 },
          "stale"
        )
      ).rejects.toThrow("changed");
      expect((await readMemoryRecord(scope, key, "seat"))?.content.body).toBe(
        corrected
      );
    },
    "COR-06": async () => {
      const first = await save();
      expect(await save()).toEqual(first);
      expect(await memoryRecordHistory(scope, key, "seat")).toHaveLength(1);
    },
    "COR-07": async () => {
      await automatic();
      await captureMemorySource(scope, key, source("later", corrected));
      const job = await claim();
      const state = await readMemoryState(scope, key);
      await correct();
      await expect(
        publishMemoryJob(scope, key, {
          ...proposal("later", corrected, "seat", 1),
          jobId: job.id,
          leaseToken: job.leaseToken,
          expectedEpoch: job.epoch,
          expectedGeneration: state.generation,
        })
      ).rejects.toThrow("changed");
      expect((await readMemoryRecord(scope, key, "seat"))?.explicit).toBe(true);
    },
    "COR-08": async () => {
      await save();
      await correct();
      expect(
        (await memoryRecordHistory(scope, key, "seat")).map(
          (revision) => revision.content.body
        )
      ).toEqual([corrected, body]);
      expect((await readMemoryGeneration(scope, key)).profile).not.toContain(
        body
      );
    },
    "FOR-01": async () => {
      await save();
      await forget();
      expect((await readMemoryGeneration(scope, key)).profile).not.toContain(
        body
      );
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "FOR-02": async () => {
      await save();
      const saved = await readMemoryRecord(scope, key, "seat");
      await forget();
      expect(await readMemoryRecord(scope, key, "seat")).toBeNull();
      expect(await memoryRecordHistory(scope, key, "seat")).toEqual([]);
      for (const input of saved?.sources ?? [])
        expect(await readMemorySource(scope, key, input.id)).toBeNull();
    },
    "FOR-03": async () => {
      await captureMemorySource(scope, key, source());
      const job = await claim();
      const value = proposal();
      value.records.push(...proposal("receipt", body, "copy").records);
      value.links = [
        { fromId: "seat", toId: "copy", relation: "co-mentioned" },
      ];
      await publish(job, value);
      await forget();
      const exported = await exportMemoryRecords(scope, key);
      expect(exported.records).toEqual([]);
      expect(exported.links).toEqual([]);
      expect(JSON.stringify(exported)).not.toContain(body);
    },
    "FOR-04": async () => {
      await automatic();
      await captureMemorySource(scope, key, source("later", corrected));
      const job = await claim();
      const value = proposal("later", corrected, "seat", 1);
      await checkpointMemoryJob(scope, key, job.id, job.leaseToken, value);
      await forget();
      await expect(publish(job, value)).rejects.toThrow(/lease|epoch/u);
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "FOR-05": async () => {
      const { input } = await automatic();
      await forget();
      await recordMemoryRecovery(scope, key, "scenario-chat", {
        expectedCursor: 0,
        nextCursor: 1,
        sources: [input],
      });
      expect(await readMemorySource(scope, key, input.id)).toBeNull();
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "FOR-06": async () => {
      await save();
      const state = await readMemoryState(scope, key);
      await saveMemoryRecall(scope, key, "recall", state.deletionEpoch, {
        messages: [{ id: "profile", content: body }],
      });
      await forget();
      await expect(readMemoryRecall(scope, key, "recall")).rejects.toThrow(
        "invalidated"
      );
    },
    "FOR-07": async () => {
      await save();
      await forget();
      await editMemoryRecord(
        scope,
        key,
        { ...initial, id: "new-seat", body: corrected },
        "new-request"
      );
      expect(
        (await findMemoryRecords(scope, key)).items.map((record) => record.id)
      ).toEqual(["new-seat"]);
    },
    "FOR-08": async () => {
      const input = {
        legacyScopeKey: "old-profile",
        entries: [{ index: 0, text: body }],
      };
      await importLegacyMemory(scope, key, input);
      const [record] = (await findMemoryRecords(scope, key)).items;
      if (!record) throw new Error("Expected imported record.");
      await forgetMemoryRecord(
        scope,
        key,
        { id: record.id, expectedRevision: record.revision },
        "forget-import"
      );
      expect((await importLegacyMemory(scope, key, input)).imported).toBe(0);
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
    },
    "AUT-01": async () => {
      const input = {
        scope,
        scopeKey: key,
        sessionId: "scenario-chat",
        turnId: "ordinary",
        text: body,
        observedAt: new Date().toISOString(),
      };
      const captured = await captureKnowledgeInput(input);
      if (!captured) throw new Error("Expected capture.");
      modelClaims([
        {
          sourceId: captured.id,
          quote: body,
          kind: "preference",
          replacesId: null,
        },
      ]);
      await maintainKnowledge();
      expect(model.generate).toHaveBeenCalledTimes(1);
      expect(model.put).toHaveBeenCalled();
      expect((await readMemoryGeneration(scope, key)).profile).toContain(body);
      expect((await readMemorySource(scope, key, captured.id))?.status).toBe(
        "processed"
      );
    },
    "AUT-02": async () => {
      const input = source();
      await recordMemoryRecovery(scope, key, "scenario-chat", {
        expectedCursor: 0,
        nextCursor: 1,
        sources: [input],
      });
      const stored = await readMemorySource(scope, key, input.id);
      expect(stored?.observedAt.toISOString()).toBe(input.observedAt);
      expect(stored?.reference).toBe(input.reference);
    },
    "AUT-03": async () => {
      const input = source();
      const page = { expectedCursor: 0, nextCursor: 1, sources: [input] };
      await captureMemorySource(scope, key, input);
      await recordMemoryRecovery(scope, key, "scenario-chat", page);
      await expect(
        recordMemoryRecovery(scope, key, "scenario-chat", page)
      ).rejects.toThrow("cursor changed");
      expect(await listMemorySources(scope, key)).toHaveLength(1);
      await publish(await claim());
      expect(await memoryRecordHistory(scope, key, "seat")).toHaveLength(1);
    },
    "AUT-04": async () => {
      await captureMemorySource(
        scope,
        key,
        source("none", "The weather is pleasant.")
      );
      await maintainKnowledge();
      expect(await readMemorySource(scope, key, "none")).toBeNull();
      expect((await findMemoryRecords(scope, key)).items).toEqual([]);
      expect(await listReadyMemoryJobs(10, [scope.workspaceId])).toEqual([]);
    },
    "AUT-05": async () => {
      await captureMemorySource(scope, key, source("failed"));
      await captureMemorySource(scope, key, source("newer", corrected));
      let job = await claim();
      for (let attempt = 1; attempt <= 5; attempt++) {
        await releaseMemoryJob(scope, key, job.id, job.leaseToken);
        if (attempt < 5) {
          await database
            .update(schema.memoryJobs)
            .set({ availableAt: new Date(0) })
            .where(eq(schema.memoryJobs.id, job.id));
          job = await claim();
        }
      }
      expect(await readMemorySource(scope, key, "failed")).toBeNull();
      const next = await claim();
      expect(next.sources.map((input) => input.id)).toEqual(["newer"]);
      await publish(next, proposal("newer", corrected));
      expect((await readMemoryGeneration(scope, key)).profile).toContain(
        corrected
      );
    },
    "AUT-06": async () => {
      await captureMemorySource(scope, key, source());
      const job = await claim();
      const value: MemoryProposal = proposal();
      await checkpointMemoryJob(scope, key, job.id, job.leaseToken, value);
      await releaseMemoryJob(scope, key, job.id, job.leaseToken);
      await database
        .update(schema.memoryJobs)
        .set({ availableAt: new Date(0) })
        .where(eq(schema.memoryJobs.id, job.id));
      await maintainKnowledge();
      expect(model.generate).not.toHaveBeenCalled();
      expect((await readMemoryGeneration(scope, key)).profile).toContain(body);
    },
    "AUT-07": async () => {
      await captureMemorySource(scope, key, source());
      const job = await claim();
      await database
        .update(schema.memoryJobs)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(schema.memoryJobs.id, job.id));
      await expect(publish(job)).rejects.toThrow("lease");
      await database.delete(schema.workspaces);
      await expect(publish(job)).rejects.toThrow("access");
    },
    "AUT-08": async () => {
      const { input } = await automatic();
      const later = source("sensitive", corrected);
      later.observedAt = new Date(
        new Date(input.observedAt).getTime() + 1_000
      ).toISOString();
      await captureMemorySource(scope, key, later);
      await setMemoryCaptureDisabled(scope, key, "scenario-chat", {
        turnId: later.turnId,
        observedAt: later.observedAt,
      });
      expect((await readMemoryRecord(scope, key, "seat"))?.content.body).toBe(
        body
      );
      expect(await readMemorySource(scope, key, later.id)).toBeNull();
      expect(
        await captureMemorySource(
          scope,
          key,
          source("future", "I prefer quiet cars.")
        )
      ).toMatchObject({ text: null, status: "excluded" });
    },
  };

describe("memory scenario evidence gates (fixture extraction, no semantic score)", () => {
  for (const repetition of memoryScenarioRepetitions) {
    describe(`repetition ${String(repetition)}`, () => {
      for (const [id, title] of memoryScenarios)
        it(`${id} ${title}`, async () => {
          expect.hasAssertions();
          await gates[id]();
        });
    });
  }
});

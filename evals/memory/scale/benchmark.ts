/* oxlint-disable eslint/no-await-in-loop -- Measure sequential operations without introducing concurrent database or CPU contention. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileMemory, inMemory } from "eve/memory/file";
import type { MemoryTurnStartedContext } from "eve/memory";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import * as Database from "@db";
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import {
  editMemoryRecord,
  findMemoryRecords,
  followMemoryLinks,
  forgetMemoryRecord,
  readMemoryRecord,
} from "@db/services/memory/records";
import { readMemoryGeneration } from "@db/services/memory/generations";
import {
  projectRecords,
  publishMemoryGeneration,
} from "@db/services/memory/projection";
import { registerMemoryScope } from "@db/services/memory/scope";
import { memoryRecordContentSchema } from "@shared/memory/schema";
import * as configuration from "@shared/memory/config";
import knowledge from "@agent/memory/knowledge";
import { scaleEnvironment } from "./env";

const scope = { userId: "scale-user", workspaceId: "scale-workspace" };
const scopeKey = "scale-knowledge";
const warmSamples = 30;
const client = new PGlite();
const database = drizzle(client, { schema });
const startedAt = performance.now();
const kinds = ["person", "organization", "preference", "episode"] as const;
const topics = ["gardening", "cooking", "painting", "cycling", "reading"];

const records = Array.from({ length: 1_000 }, (_, index) => {
  const topic = topics[index % topics.length] ?? "gardening";
  const multilingual = index % 20 === 0;
  const body = multilingual
    ? `京都の静かな庭園が好きです。🌿 I enjoy ${topic} group ${String(index)}. ${"季節の花と落ち着いた場所を選びます。".repeat(index % 100 === 0 ? 90 : 2)}`
    : `For ${topic} group ${String(index)}, I prefer a relaxed pace with an afternoon break. My usual plan includes a small group and advance notice.`;
  return {
    workspaceId: scope.workspaceId,
    scopeKey,
    id: `record-${String(index).padStart(4, "0")}`,
    revision: 1,
    explicit: index % 7 === 0,
    lastOperationId: `seed-${String(index)}`,
    updatedAt: new Date(Date.UTC(2020, 0, 1) + index * 60_000),
    content: memoryRecordContentSchema.parse({
      kind: kinds[index % kinds.length],
      title: `${multilingual ? "Multilingual" : topic} group ${String(index)}`,
      body,
      aliases: [`group-${String(index)}`, `circle-${String(index)}`],
      status:
        index % 19 === 0 ? "expired" : index % 17 === 0 ? "disputed" : "active",
      expiresAt: index % 23 === 0 ? "2000-01-01T00:00:00.000Z" : null,
      evidence: [
        { sourceId: `source-${String(index)}`, start: 0, end: body.length },
      ],
    }),
  };
});

const target = records[1];
if (!target) throw new Error("Missing fixture target.");
const targetBody = "I prefer a quiet carriage on overnight trains.";
target.explicit = false;
target.updatedAt = new Date(0);
target.content = memoryRecordContentSchema.parse({
  kind: "preference",
  title: "Night train seating",
  body: targetBody,
  aliases: ["sleeper seating"],
  evidence: [{ sourceId: "source-1", start: 0, end: targetBody.length }],
});
const expired = records[2];
if (!expired) throw new Error("Missing expired fixture.");
const expiredBody = "The Juniper workshop took place in 2001.";
expired.content = memoryRecordContentSchema.parse({
  kind: "episode",
  title: "Juniper archive",
  body: expiredBody,
  status: "expired",
  evidence: [{ sourceId: "source-2", start: 0, end: expiredBody.length }],
});

function context(operationId: string, query = "overnight trains") {
  return {
    abortSignal: new AbortController().signal,
    async getSandbox() {
      throw new Error("The memory benchmark does not use a sandbox.");
    },
    memory: {
      scope: { key: scopeKey, namespace: "scale", value: scope.workspaceId },
      slot: "knowledge",
    },
    messages: [],
    operationId,
    session: {
      id: "scale-session",
      turn: { id: "scale-turn", sequence: 1 },
      auth: {
        current: {
          attributes: { workspaceId: scope.workspaceId },
          authenticator: "authjs",
          principalId: scope.userId,
          principalType: "user",
        },
        initiator: null,
      },
    },
    turn: {
      id: "scale-turn",
      input: [
        Object.assign(
          { role: "user" as const, content: query },
          { kind: "user" }
        ),
      ],
      sequence: 1,
    },
  } satisfies MemoryTurnStartedContext;
}

function size(text: string) {
  const utf8Bytes = Buffer.byteLength(text, "utf8");
  return {
    characters: text.length,
    utf8Bytes,
    byteFallbackTokenCeiling: utf8Bytes,
  };
}

async function measure<T>(
  name: string,
  action: (sample: number) => T | Promise<T>
) {
  const firstStart = performance.now();
  const first = await action(-1);
  const firstCallMs = performance.now() - firstStart;
  const samples: number[] = [];
  for (let sample = 0; sample < warmSamples; sample += 1) {
    const start = performance.now();
    await action(sample);
    samples.push(performance.now() - start);
  }
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    result: first,
    metric: {
      name,
      firstCallMs,
      warm: {
        samples: warmSamples,
        p50Ms: sorted[Math.ceil(warmSamples * 0.5) - 1],
        p95Ms: sorted[Math.ceil(warmSamples * 0.95) - 1],
        minMs: sorted[0],
        maxMs: sorted.at(-1),
        rawMs: samples,
      },
      output: size(JSON.stringify(first)),
    },
  };
}

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

it("measures production memory operations at 1,000 synthetic records", async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  const migrationMs = performance.now() - startedAt;
  // SAFETY: PGlite implements the same Drizzle query contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Replace only the database boundary with the existing test driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  vi.spyOn(configuration, "knowledgeMemoryModeForWorkspace").mockReturnValue(
    "enabled"
  );
  const seedStart = performance.now();
  await ensureScope(scope);
  await database.insert(schema.agentSessions).values({
    sessionId: "scale-session",
    workspaceId: scope.workspaceId,
    createdByUserId: scope.userId,
  });
  await registerMemoryScope(scope, scopeKey, "scale", "scale-session");
  await database.insert(schema.memoryRecords).values(records);
  await database.insert(schema.memorySources).values(
    records.map((record, index) => ({
      workspaceId: scope.workspaceId,
      scopeKey,
      id: `source-${String(index)}`,
      kind: "user" as const,
      text: record.content.body,
      reference: `synthetic:${record.id}`,
      observedAt: record.updatedAt,
      status: "processed" as const,
    }))
  );
  await database.insert(schema.memoryLinks).values([
    ...records.slice(3, 43).map((record) => ({
      workspaceId: scope.workspaceId,
      scopeKey,
      fromId: target.id,
      toId: record.id,
      relation: "co-mentioned",
    })),
    {
      workspaceId: scope.workspaceId,
      scopeKey,
      fromId: "record-0003",
      toId: "record-0043",
      relation: "co-mentioned",
    },
  ]);
  await Database.db.transaction((transaction) =>
    publishMemoryGeneration(transaction, scope, scopeKey)
  );
  const seedMs = performance.now() - seedStart;

  const recent = await measure("search_recent", () =>
    findMemoryRecords(scope, scopeKey)
  );
  const relevant = await measure("search_older_relevant", () =>
    findMemoryRecords(scope, scopeKey, { query: "overnight trains" })
  );
  const alias = await measure("search_exact_alias", () =>
    findMemoryRecords(scope, scopeKey, { query: "sleeper seating" })
  );
  const broad = await measure("search_broad", () =>
    findMemoryRecords(scope, scopeKey, { query: "group" })
  );
  const absent = await measure("search_no_match", () =>
    findMemoryRecords(scope, scopeKey, { query: "zz-no-such-fact" })
  );
  const historical = await measure("search_historical", () =>
    findMemoryRecords(scope, scopeKey, {
      query: "Juniper",
      includeHistorical: true,
    })
  );
  const read = await measure("read_with_source", () =>
    readMemoryRecord(scope, scopeKey, target.id)
  );
  const linked = await measure("follow_one_hop", () =>
    followMemoryLinks(scope, scopeKey, target.id)
  );
  const projected = await measure("project_1000_in_memory", () =>
    projectRecords(records, new Date("2025-01-01T00:00:00.000Z"))
  );
  const generation = await measure("read_generation_1000", () =>
    readMemoryGeneration(scope, scopeKey)
  );
  const recall = await measure("recall_fresh_operation", (sample) =>
    knowledge.provider.recall["turn.started"](
      context(`recall-${String(sample)}`)
    )
  );
  const replay = await measure("recall_same_operation", () =>
    knowledge.provider.recall["turn.started"](context("recall--1"))
  );
  const multilingual = await measure("recall_multilingual", (sample) =>
    knowledge.provider.recall["turn.started"](
      context(`multilingual-${String(sample)}`, "Multilingual")
    )
  );

  expect(recent.result.items).toHaveLength(20);
  expect(recent.result.items.map((record) => record.id)).not.toContain(
    target.id
  );
  expect(relevant.result.items[0]?.id).toBe(target.id);
  expect(alias.result.items[0]?.id).toBe(target.id);
  expect(broad.result.items).toHaveLength(20);
  expect(absent.result.items).toEqual([]);
  expect(historical.result.items[0]?.id).toBe(expired.id);
  expect(
    (await findMemoryRecords(scope, scopeKey, { query: "Juniper" })).items
  ).toEqual([]);
  expect(read.result?.sources[0]?.text).toBe(target.content.body);
  expect(linked.result.links).toHaveLength(40);
  expect(linked.result.records).toHaveLength(40);
  expect(linked.result.records.map((record) => record.id)).not.toContain(
    "record-0043"
  );
  expect(
    Buffer.byteLength(JSON.stringify(projected.result.profile), "utf8")
  ).toBeLessThanOrEqual(6_000);
  expect(
    Buffer.byteLength(JSON.stringify(projected.result.currentContext), "utf8")
  ).toBeLessThanOrEqual(6_000);
  expect(replay.result).toEqual(recall.result);

  const recallText = recall.result.messages[0]?.content ?? "";
  const multilingualText = multilingual.result.messages[0]?.content ?? "";
  expect(recallText).toContain(target.content.body);
  expect(multilingualText).toContain("京都");
  expect(Buffer.byteLength(recallText, "utf8")).toBeLessThanOrEqual(17_500);
  expect(Buffer.byteLength(multilingualText, "utf8")).toBeLessThanOrEqual(
    17_500
  );

  const legacyBackend = inMemory();
  const legacy = fileMemory({ backend: legacyBackend });
  const legacyContext = {
    ...context("legacy"),
    memory: {
      scope: {
        key: "scale-legacy",
        namespace: "profile",
        value: scope.workspaceId,
      },
      slot: "profile",
    },
  };
  const legacyTools = await legacy.tools?.({
    ...legacyContext,
    model: null,
    channel: {},
  });
  if (!legacyTools?.save_memory)
    throw new Error("Missing installed legacy save tool.");
  let admitted = 0;
  let rejectedOversized = 0;
  let capacityReason = "";
  for (const record of records) {
    try {
      // SAFETY: Eve's file-memory tool erases input types; text is its documented schema.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Call the installed provider's actual save tool.
      const input = { text: record.content.body } as never;
      await legacyTools.save_memory.execute(input, {
        ...legacyContext,
        callId: `legacy-${String(admitted)}`,
        toolName: "profile__save_memory",
        async getToken() {
          throw new Error("No credentials in this benchmark.");
        },
        requireAuth() {
          throw new Error("No authentication transitions in this benchmark.");
        },
      });
      admitted += 1;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Memory text exceeds")
      ) {
        rejectedOversized += 1;
        continue;
      }
      if (!(error instanceof RangeError)) throw error;
      capacityReason = error.message;
      break;
    }
  }
  const legacyRecall = await measure(
    "legacy_default_admitted_prefix_recall",
    () => legacy.recall["turn.started"](legacyContext)
  );
  const legacyText = legacyRecall.result?.messages[0]?.content ?? "";
  const legacyStressDocument = `<!-- eve-memory-file-v1 lastAllocatedIndex=999 -->\n${records.map((record, index) => `${String(index)}: ${record.content.body}`).join("\n")}\n`;
  let stressResult: string;
  await legacyBackend.write({
    key: "scale-legacy-stress",
    expectedVersion: null,
    content: legacyStressDocument,
    signal: legacyContext.abortSignal,
  });
  try {
    await legacy.recall["turn.started"]({
      ...legacyContext,
      memory: {
        ...legacyContext.memory,
        scope: { ...legacyContext.memory.scope, key: "scale-legacy-stress" },
      },
    });
    stressResult = "supported";
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    stressResult = error.message;
  }
  expect(admitted).toBeLessThan(1_000);
  expect(admitted).toBeGreaterThan(0);
  expect(legacyText.length).toBeLessThanOrEqual(4_000);

  const correctionStart = performance.now();
  const corrected = await editMemoryRecord(
    scope,
    scopeKey,
    {
      id: target.id,
      expectedRevision: 1,
      kind: "preference",
      title: "Night train seating",
      body: "I prefer an aisle seat on overnight trains.",
    },
    "scale-correction"
  );
  const correctionRecall = await knowledge.provider.recall["turn.started"](
    context("after-correction")
  );
  const correctionToRecallMs = performance.now() - correctionStart;
  expect(correctionRecall.messages[0]?.content).toContain(
    corrected.content.body
  );
  expect(correctionRecall.messages[0]?.content).not.toContain(
    target.content.body
  );
  const forgetStart = performance.now();
  await forgetMemoryRecord(
    scope,
    scopeKey,
    { id: target.id, expectedRevision: corrected.revision },
    "scale-forget"
  );
  const forgottenRecall = await knowledge.provider.recall["turn.started"](
    context("after-forget")
  );
  const forgetToRecallMs = performance.now() - forgetStart;
  expect(forgottenRecall.messages[0]?.content).not.toContain(
    corrected.content.body
  );
  expect(await readMemoryRecord(scope, scopeKey, target.id)).toBeNull();

  const packageVersion = z.object({ version: z.string() });
  const eve = packageVersion.parse(
    JSON.parse(await readFile("node_modules/eve/package.json", "utf8"))
  ).version;
  const pglite = packageVersion.parse(
    JSON.parse(
      await readFile("node_modules/@electric-sql/pglite/package.json", "utf8")
    )
  ).version;
  const measuredSourcePaths = [
    "evals/memory/scale/benchmark.ts",
    "agent/memory/knowledge.ts",
    "db/services/memory/records.ts",
    "db/services/memory/generations.ts",
    "db/services/memory/projection.ts",
  ];
  const measuredSource = await Promise.all(
    measuredSourcePaths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    }))
  );
  const metrics = [
    recent,
    relevant,
    alias,
    broad,
    absent,
    historical,
    read,
    linked,
    projected,
    generation,
    recall,
    replay,
    multilingual,
    legacyRecall,
  ].map((item) => item.metric);
  const report = {
    run: scaleEnvironment.MEMORY_SCALE_RUN,
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      eve,
      pglite,
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim().length > 0,
    },
    fixture: {
      records: records.length,
      sourceCount: records.length,
      links: 41,
      sha256: createHash("sha256")
        .update(JSON.stringify(records))
        .digest("hex"),
      multilingualRecords: records.filter((record) =>
        record.content.body.includes("京都")
      ).length,
      olderTarget: target.id,
      fixtureBytes: Buffer.byteLength(JSON.stringify(records), "utf8"),
    },
    measuredSource,
    setup: { freshDatabaseMigrationMs: migrationMs, seedMs },
    metrics,
    recallContent: {
      knowledge: size(recallText),
      multilingual: size(multilingualText),
      legacy: size(legacyText),
    },
    legacy: {
      admittedRecords: admitted,
      offeredRecords: records.length,
      oversizedEntriesRejectedBeforeCapacity: rejectedOversized,
      capacityReason,
      stressDocumentBytes: Buffer.byteLength(legacyStressDocument, "utf8"),
      stressResult,
    },
    freshness: { correctionToRecallMs, forgetToRecallMs, samples: 1 },
    limitations: [
      "Synthetic data in PGlite/WASM on one local host; no network, PostgreSQL server, Blob, model, hosted queue, or production p95.",
      "First call means first measured operation after migration and seeding, not a cold machine or serverless cold start. Each run uses a new process and database; warm samples share process caches.",
      "Legacy baseline uses installed Eve fileMemory with its actual default 4,000-character save limit and inMemory backend. Entries exceeding its actual per-entry byte limit are rejected and skipped. It admits only an eligible prefix, so latency is not a like-for-like 1,000-record comparison. Raw 1,000-record stress input is tested separately against the actual parser; unsupported capacity is not a quality failure.",
      "Character counts are JavaScript UTF-16 code units. Byte counts are UTF-8. Byte-level token ceiling applies only to text encoders with byte fallback, excludes message framing, and is deliberately conservative; this is not an exact model token count or proof of a 4,500-token budget.",
      "Latency is descriptive, not an assertion. Semantic model quality, automatic extraction freshness, and spend require a live evaluation.",
    ],
  };
  const markdown = [
    `# Memory scale benchmark — run ${String(report.run)}`,
    "",
    `${report.environment.cpu ?? "Unknown CPU"}; Node ${report.environment.node}; Eve ${eve}; PGlite ${pglite}. Revision ${report.environment.revision}${report.environment.dirty ? " (with uncommitted changes; measured source hashes are in JSON)" : ""}.`,
    "",
    `Exactly 1,000 synthetic records, 1,000 source rows, 41 links, ${String(report.fixture.multilingualRecords)} multilingual records. Fixture SHA-256: ${report.fixture.sha256}. Fresh migration: ${migrationMs.toFixed(2)} ms; seed: ${seedMs.toFixed(2)} ms.`,
    "",
    "| Operation | First call ms | Warm p50 ms | Warm p95 ms | Output chars | Output UTF-8 bytes |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...metrics.map(
      (metric) =>
        `| ${metric.name} | ${metric.firstCallMs.toFixed(3)} | ${(metric.warm.p50Ms ?? 0).toFixed(3)} | ${(metric.warm.p95Ms ?? 0).toFixed(3)} | ${String(metric.output.characters)} | ${String(metric.output.utf8Bytes)} |`
    ),
    "",
    `Each warm percentile uses ${String(warmSamples)} sequential samples. Knowledge recall content: ${String(report.recallContent.knowledge.characters)} chars / ${String(report.recallContent.knowledge.utf8Bytes)} UTF-8 bytes. Multilingual recall: ${String(report.recallContent.multilingual.characters)} chars / ${String(report.recallContent.multilingual.utf8Bytes)} bytes. Conservative byte-fallback text token ceilings equal those byte counts; model tokenization is not measured.`,
    "",
    `Actual default legacy provider admitted ${String(admitted)} of 1,000 entries (skipping ${String(rejectedOversized)} oversized entries) before: ${capacityReason} Its ${String(report.recallContent.legacy.characters)}-character recall is a smaller-load baseline. The raw ${String(report.legacy.stressDocumentBytes)}-byte 1,000-entry stress document returned: ${stressResult}`,
    "",
    `One-shot explicit correction through fresh recall: ${correctionToRecallMs.toFixed(3)} ms; forget through fresh recall: ${forgetToRecallMs.toFixed(3)} ms. Assertions verify older target and alias retrieval, source support, historical filtering, 20-result bound, 40-link one-hop bound, serialized projection/recall UTF-8 byte bounds, retry-stable recall, and correction/forget visibility.`,
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
  await mkdir(scaleEnvironment.MEMORY_SCALE_OUTPUT, { recursive: true });
  const basename = join(
    scaleEnvironment.MEMORY_SCALE_OUTPUT,
    `run-${String(report.run)}`
  );
  await writeFile(`${basename}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${basename}.md`, markdown);
  console.log(`Memory scale run ${String(report.run)}: ${basename}.json`);
});

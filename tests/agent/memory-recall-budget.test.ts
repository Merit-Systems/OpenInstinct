import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { MemoryTurnStartedContext } from "eve/memory";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import * as Database from "@db";
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import { findMemoryRecords } from "@db/services/memory/records";
import { readMemoryGeneration } from "@db/services/memory/generations";
import { publishMemoryGeneration } from "@db/services/memory/projection";
import { registerMemoryScope } from "@db/services/memory/scope";
import { memoryRecordContentSchema } from "@shared/memory/schema";
import * as configuration from "@shared/memory/config";
import knowledge from "@agent/memory/knowledge";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "budget-user", workspaceId: "budget-workspace" };
const scopeKey = "budget-knowledge";

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the production Drizzle query contract in isolation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Replace only the database driver for this integration test.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  vi.spyOn(configuration, "knowledgeMemoryModeForWorkspace").mockReturnValue(
    "enabled"
  );
}, 20_000);

beforeEach(async () => {
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  await database.insert(schema.agentSessions).values({
    sessionId: "budget-session",
    workspaceId: scope.workspaceId,
    createdByUserId: scope.userId,
  });
  await registerMemoryScope(scope, scopeKey, "budget", "budget-session");
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function record(
  id: string,
  body: string,
  kind: "preference" | "episode" = "preference"
) {
  return {
    workspaceId: scope.workspaceId,
    scopeKey,
    id,
    revision: 1,
    explicit: false,
    lastOperationId: id,
    updatedAt: new Date(0),
    content: memoryRecordContentSchema.parse({
      kind,
      title: id,
      body,
      evidence: [{ sourceId: `source-${id}`, start: 0, end: body.length }],
    }),
  };
}

function context(query: string) {
  return {
    abortSignal: new AbortController().signal,
    async getSandbox() {
      throw new Error("No sandbox needed.");
    },
    memory: {
      scope: { key: scopeKey, namespace: "budget", value: scope.workspaceId },
      slot: "knowledge",
    },
    messages: [],
    operationId: "budget-recall",
    session: {
      id: "budget-session",
      turn: { id: "budget-turn", sequence: 1 },
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
      id: "budget-turn",
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

it.each(["漢🌿", '"\\\n\t'])(
  "bounds serialized projection and recall bytes for %j without splitting records",
  async (characters) => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      record(
        `entry-${String(index).padStart(2, "0")}`,
        `A remembered statement: ${characters.repeat(500)} ends here.`,
        index % 2 === 0 ? "preference" : "episode"
      )
    );
    await database.insert(schema.memoryRecords).values(rows);
    await Database.db.transaction((transaction) =>
      publishMemoryGeneration(transaction, scope, scopeKey)
    );
    const generation = await readMemoryGeneration(scope, scopeKey);
    expect(generation.recordIds.length).toBeGreaterThan(0);
    expect(generation.recordIds.length).toBeLessThan(rows.length);
    expect(
      Buffer.byteLength(JSON.stringify(generation.profile), "utf8")
    ).toBeLessThanOrEqual(6_000);
    expect(
      Buffer.byteLength(JSON.stringify(generation.currentContext), "utf8")
    ).toBeLessThanOrEqual(6_000);
    for (const id of generation.recordIds) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error("Missing projected fixture.");
      const projection =
        row.content.kind === "episode"
          ? generation.currentContext
          : generation.profile;
      expect(projection).toContain(
        `- [${id}] ${row.content.title}: ${row.content.body}`
      );
    }
    const recall = await knowledge.provider.recall["turn.started"](
      context("entry")
    );
    const content = recall.messages[0]?.content ?? "";
    expect(content.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(17_500);
    expect(() => {
      JSON.parse(content.slice(content.indexOf("\n") + 1));
    }).not.toThrow();
  }
);

it("skips an oversized candidate and recalls a later smaller relevant record", async () => {
  const oversized = record("budgettarget", "漢".repeat(3_000));
  const small = record(
    "budgettarget-small",
    "I prefer a quiet carriage on overnight trains."
  );
  const fillers = Array.from({ length: 4 }, (_, index) =>
    record(
      `filler-${String(index)}`,
      "庭".repeat(900),
      index % 2 === 0 ? "preference" : "episode"
    )
  );
  await database
    .insert(schema.memoryRecords)
    .values([oversized, small, ...fillers]);
  await Database.db.transaction((transaction) =>
    publishMemoryGeneration(transaction, scope, scopeKey)
  );
  const candidates = await findMemoryRecords(scope, scopeKey, {
    query: "budgettarget",
  });
  expect(candidates.items.map((candidate) => candidate.id)).toEqual([
    oversized.id,
    small.id,
  ]);
  const recall = await knowledge.provider.recall["turn.started"](
    context("budgettarget")
  );
  const content = recall.messages[0]?.content ?? "";
  const bundle = z
    .object({ records: z.array(z.object({ id: z.string() })) })
    .parse(JSON.parse(content.slice(content.indexOf("\n") + 1)));
  expect(bundle.records.map((candidate) => candidate.id)).toEqual([small.id]);
  expect(content).toContain(small.content.body);
  expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(17_500);
});

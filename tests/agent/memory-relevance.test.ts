import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { findMemoryRecords } from "@db/services/memory/records";
import { ensureScope } from "@db/services/scope";
import { memoryRecordContentSchema } from "@shared/memory/schema";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "alice", workspaceId: "workspace-alice" };
const scopeKey = "knowledge-production";

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the Drizzle service contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise production queries with the test driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  await ensureScope(scope);
}, 20_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

it("finds an older correction target beyond the newest 20 records using the source query", async () => {
  const record = (id: string, body: string, updatedAt: Date) => ({
    workspaceId: scope.workspaceId,
    scopeKey,
    id,
    revision: 1,
    explicit: false,
    lastOperationId: id,
    updatedAt,
    content: memoryRecordContentSchema.parse({
      kind: "preference",
      title: body,
      body,
      evidence: [{ sourceId: `source-${id}`, start: 0, end: body.length }],
    }),
  });
  await database
    .insert(schema.memoryRecords)
    .values([
      record("older-trains", "I prefer window seats on trains.", new Date(0)),
      ...Array.from({ length: 21 }, (_, index) =>
        record(
          `newer-${String(index)}`,
          `I prefer pastry variety ${String(index)}.`,
          new Date(1_000 + index)
        )
      ),
    ]);

  const recent = await findMemoryRecords(scope, scopeKey, {});
  expect(recent.items).toHaveLength(20);
  expect(recent.nextOffset).toBe(20);
  expect(recent.items.map((item) => item.id)).not.toContain("older-trains");

  const relevant = await findMemoryRecords(scope, scopeKey, {
    query: "Actually, I now prefer quiet cars on trains.",
  });
  expect(relevant.items).toHaveLength(20);
  expect(relevant.items[0]).toMatchObject({ id: "older-trains", revision: 1 });
  expect(await findMemoryRecords(scope, scopeKey, { query: "  \n " })).toEqual(
    recent
  );
});

/* oxlint-disable eslint/no-await-in-loop -- Exercise dependent durable job attempts and publication. */
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
import {
  claimMemoryJob,
  checkpointMemoryJob,
  listReadyMemoryJobs,
  publishMemoryJob,
  releaseMemoryJob,
} from "@db/services/memory/jobs";
import {
  forgetMemoryRecord,
  exportMemoryRecords,
  readMemoryRecord,
  saveMemoryRecord,
} from "@db/services/memory/records";
import { registerMemoryScope } from "@db/services/memory/scope";
import {
  captureMemorySource,
  readMemorySource,
} from "@db/services/memory/sources";
import { ensureScope } from "@db/services/scope";
import { memoryProposalSchema } from "@shared/memory/schema";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "alice", workspaceId: "workspace-alice" };
const scopeKey = "knowledge-production";

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the Drizzle service contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise production queries with the test driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
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

function source(id: string, text: string) {
  return {
    id,
    kind: "user" as const,
    text,
    reference: `session:alice:turn:${id}`,
    sessionId: "alice",
    turnId: id,
    observedAt: new Date().toISOString(),
  };
}

async function claim() {
  const [ready] = await listReadyMemoryJobs(10, [scope.workspaceId]);
  if (!ready) throw new Error("Expected queued maintenance.");
  const job = await claimMemoryJob(scope, scopeKey, ready.id);
  if (!job) throw new Error("Expected claimable maintenance.");
  return job;
}

describe("knowledge memory dead letters", () => {
  it.each(["release", "expired lease"])(
    "isolates failed inputs after the fifth %s and processes newer input",
    async (failure) => {
      const failed = source("failed", "I prefer window seats.");
      await captureMemorySource(scope, scopeKey, failed);
      await captureMemorySource(
        scope,
        scopeKey,
        source("newer", "I prefer quiet trains.")
      );
      let job = await claim();
      for (let attempt = 1; attempt < 5; attempt++) {
        expect(job.sources.map((entry) => entry.id)).toEqual([failed.id]);
        await releaseMemoryJob(scope, scopeKey, job.id, job.leaseToken);
        await database
          .update(schema.memoryJobs)
          .set({ availableAt: new Date(0) })
          .where(eq(schema.memoryJobs.id, job.id));
        job = await claim();
      }
      expect(job.attempts).toBe(5);
      await checkpointMemoryJob(
        scope,
        scopeKey,
        job.id,
        job.leaseToken,
        memoryProposalSchema.parse({
          records: [
            {
              id: "failed-record",
              expectedRevision: 0,
              content: {
                kind: "preference",
                title: "Failed preference",
                body: failed.text,
                evidence: [
                  { sourceId: failed.id, start: 0, end: failed.text.length },
                ],
              },
            },
          ],
        })
      );
      if (failure === "release") {
        await releaseMemoryJob(scope, scopeKey, job.id, job.leaseToken);
      } else {
        await database
          .update(schema.memoryJobs)
          .set({ leaseExpiresAt: new Date(0) })
          .where(eq(schema.memoryJobs.id, job.id));
      }
      expect(await claimMemoryJob(scope, scopeKey, job.id)).toBeNull();
      expect(
        await database
          .select()
          .from(schema.memoryJobs)
          .where(eq(schema.memoryJobs.id, job.id))
      ).toMatchObject([{ status: "dead_letter", checkpoint: null }]);
      expect(await readMemorySource(scope, scopeKey, failed.id)).toBeNull();
      expect(await captureMemorySource(scope, scopeKey, failed)).toMatchObject({
        status: "failed",
        text: null,
        reference: null,
        sessionId: null,
        turnId: null,
      });
      expect(
        JSON.stringify(await exportMemoryRecords(scope, scopeKey))
      ).not.toContain(failed.text);

      const next = await claim();
      expect(next.id).not.toBe(job.id);
      expect(next.sources.map((entry) => entry.id)).toEqual(["newer"]);
      const body = "I prefer quiet trains.";
      await publishMemoryJob(scope, scopeKey, {
        jobId: next.id,
        leaseToken: next.leaseToken,
        expectedEpoch: next.epoch,
        ...memoryProposalSchema.parse({
          records: [
            {
              id: "trains",
              expectedRevision: 0,
              content: {
                kind: "preference",
                title: "Trains",
                body,
                evidence: [{ sourceId: "newer", start: 0, end: body.length }],
              },
            },
          ],
        }),
      });
      expect(await readMemoryRecord(scope, scopeKey, "trains")).toMatchObject({
        content: { body },
      });

      await forgetMemoryRecord(
        scope,
        scopeKey,
        { id: "trains", expectedRevision: 1 },
        "forget"
      );
      expect(await readMemorySource(scope, scopeKey, failed.id)).toBeNull();
      expect(await captureMemorySource(scope, scopeKey, failed)).toMatchObject({
        status: "forgotten",
        text: null,
      });
    }
  );

  it("preserves evidence saved explicitly while the final attempt was running", async () => {
    const input = source("explicit", "I prefer aisle seats.");
    await captureMemorySource(scope, scopeKey, input);
    const job = await claim();
    await database
      .update(schema.memoryJobs)
      .set({ attempts: 5 })
      .where(eq(schema.memoryJobs.id, job.id));
    await saveMemoryRecord(
      scope,
      scopeKey,
      {
        id: "seat",
        expectedRevision: 0,
        content: {
          kind: "preference",
          title: "Seat",
          body: input.text,
          evidence: [{ sourceId: input.id, start: 0, end: input.text.length }],
        },
      },
      "explicit-save",
      { sourceId: input.id }
    );
    await releaseMemoryJob(scope, scopeKey, job.id, job.leaseToken);
    expect(await readMemorySource(scope, scopeKey, input.id)).toMatchObject({
      status: "processed",
      text: input.text,
    });
    expect(await readMemoryRecord(scope, scopeKey, "seat")).toMatchObject({
      explicit: true,
      content: { body: input.text },
    });
  });
});

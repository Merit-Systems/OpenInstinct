import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { readMemoryHealth } from "@db/services/memory/health";
import { ensureScope } from "@db/services/scope";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "alice", workspaceId: "workspace-alice" };
const other = { userId: "bob", workspaceId: "workspace-bob" };
const scopeKey = "production-memory";
const oldest = new Date("2026-10-20T12:00:00Z");

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the Drizzle service contract in an isolated database.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise production queries with the test driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  await ensureScope(scope);
  await ensureScope(other);
  await database.insert(schema.memorySources).values(
    [
      { workspaceId: scope.workspaceId, scopeKey },
      { workspaceId: scope.workspaceId, scopeKey: "preview-memory" },
      { workspaceId: other.workspaceId, scopeKey },
    ].flatMap((partition) =>
      ["pending", "failed"].map((status) => ({
        workspaceId: partition.workspaceId,
        scopeKey: partition.scopeKey,
        id: status,
        kind: "user" as const,
        status:
          status === "pending" ? ("pending" as const) : ("failed" as const),
        text: status === "pending" ? "Private synthetic preference." : null,
        observedAt: oldest,
        createdAt: oldest,
      }))
    )
  );
  await database.insert(schema.memoryJobs).values([
    {
      ...scope,
      scopeKey,
      requestedByUserId: scope.userId,
      epoch: 0,
      createdAt: oldest,
      availableAt: oldest,
    },
    {
      ...other,
      scopeKey,
      requestedByUserId: other.userId,
      epoch: 0,
      createdAt: oldest,
    },
  ]);
  await database.insert(schema.memoryArtifacts).values({
    workspaceId: scope.workspaceId,
    scopeKey,
    pathname: "memory/private-synthetic-path.md",
    jobId: "0554b866-5d5d-4234-b6c2-e98929ad703c",
    userId: scope.userId,
    sha256: "0".repeat(64),
    recordId: "private-record",
    revision: 1,
    status: "purge",
    createdAt: oldest,
  });
  await database.insert(schema.memoryGenerations).values({
    workspaceId: scope.workspaceId,
    scopeKey,
    generation: 1,
    deletionEpoch: 0,
    profile: "Private synthetic profile.",
    currentContext: "",
    recordIds: ["private-record"],
    createdAt: oldest,
  });
}, 20_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("memory operational status", () => {
  it("reports scoped counts and timestamps without saved content or identifiers", async () => {
    const health = await readMemoryHealth(scope, scopeKey);
    expect(health).toEqual({
      sources: [
        { status: "failed", count: 1, oldestCreatedAt: oldest },
        { status: "pending", count: 1, oldestCreatedAt: oldest },
      ],
      jobs: [
        {
          status: "pending",
          count: 1,
          oldestCreatedAt: oldest,
          nextAvailableAt: oldest,
        },
      ],
      artifacts: [{ status: "purge", count: 1, oldestCreatedAt: oldest }],
      lastPublishedAt: oldest,
    });
    expect(JSON.stringify(health)).not.toMatch(/private|synthetic|alice|bob/iu);
    expect(await readMemoryHealth(scope, "empty-scope")).toEqual({
      sources: [],
      jobs: [],
      artifacts: [],
      lastPublishedAt: null,
    });
  });

  it("rejects a forged workspace and revocation", async () => {
    await expect(
      readMemoryHealth({ ...scope, workspaceId: other.workspaceId }, scopeKey)
    ).rejects.toThrow("access");
    await database.delete(schema.workspaceMemberships);
    await expect(readMemoryHealth(scope, scopeKey)).rejects.toThrow("access");
  });
});

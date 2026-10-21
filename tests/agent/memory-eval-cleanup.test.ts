import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { ensureScope } from "@db/services/scope";
import { accessScopeForUser } from "@shared/identity/access-scope";

const boundary = vi.hoisted(() => ({
  del: vi.fn<() => Promise<void>>(),
  sleep: vi.fn<() => Promise<void>>(),
}));
vi.mock("@vercel/blob", () => ({ del: boundary.del }));
vi.mock("node:timers/promises", () => ({ setTimeout: boundary.sleep }));
import { cleanupMemoryEvalArtifacts } from "@evals/memory/cleanup";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = accessScopeForUser("better-auth:browser-benchmark");
const now = new Date("2030-01-01T00:00:00.000Z");

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the production Drizzle query contract in isolation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise the actual purge service with the existing test database driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
  await database.delete(schema.memoryArtifacts);
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  boundary.del.mockReset().mockResolvedValue(undefined);
  boundary.sleep.mockReset().mockImplementation(async () => {
    vi.setSystemTime(now.getTime() + 5 * 60_000 + 1_000);
  });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function artifact(workspaceId = scope.workspaceId) {
  return {
    workspaceId,
    scopeKey: "eval-knowledge",
    pathname: `memory/${workspaceId}/synthetic.md`,
    jobId: "00000000-0000-4000-8000-000000000001",
    userId: scope.userId,
    sha256: "a".repeat(64),
    recordId: "synthetic",
    revision: 1,
    status: "published" as const,
    createdAt: now,
  };
}

it("waits for the real reservation grace and deletes only this fixture workspace", async () => {
  const own = artifact();
  const other = artifact("unrelated-workspace");
  await database.insert(schema.memoryArtifacts).values([own, other]);
  boundary.del.mockImplementation(async () => {
    expect(Date.now() - own.createdAt.getTime()).toBeGreaterThanOrEqual(
      5 * 60_000
    );
  });
  await cleanupMemoryEvalArtifacts();
  expect(boundary.sleep).toHaveBeenCalledExactlyOnceWith(1_000);
  expect(boundary.del).toHaveBeenCalledExactlyOnceWith(
    own.pathname,
    expect.objectContaining({ token: "vercel_blob_rw_test" })
  );
  expect(await database.select().from(schema.memoryArtifacts)).toMatchObject([
    { workspaceId: other.workspaceId, status: "published" },
  ]);
});

it("keeps the deletion ledger when Blob deletion fails", async () => {
  await database
    .insert(schema.memoryArtifacts)
    .values({ ...artifact(), createdAt: new Date(0) });
  boundary.del.mockRejectedValue(new Error("Synthetic Blob failure"));
  await expect(cleanupMemoryEvalArtifacts()).rejects.toThrow(
    "Synthetic Blob failure"
  );
  expect(await database.select().from(schema.memoryArtifacts)).toMatchObject([
    { status: "purge" },
  ]);
});

it("returns immediately when this fixture created no artifacts", async () => {
  await cleanupMemoryEvalArtifacts();
  expect(boundary.del).not.toHaveBeenCalled();
  expect(boundary.sleep).not.toHaveBeenCalled();
});

it("retains the ledger when the bounded wait expires", async () => {
  await database.insert(schema.memoryArtifacts).values(artifact());
  boundary.sleep.mockImplementation(async () => {
    vi.setSystemTime(now.getTime() + 6 * 60_000);
  });
  await expect(cleanupMemoryEvalArtifacts()).rejects.toThrow(
    "awaiting safe deletion"
  );
  expect(boundary.del).not.toHaveBeenCalled();
  expect(await database.select().from(schema.memoryArtifacts)).toHaveLength(1);
});

it("does not start another deletion after the overall deadline", async () => {
  await database.insert(schema.memoryArtifacts).values([
    { ...artifact(), createdAt: new Date(0) },
    {
      ...artifact(),
      pathname: "memory/another-owned-artifact.md",
      createdAt: new Date(0),
    },
  ]);
  boundary.del.mockImplementation(async () => {
    vi.setSystemTime(now.getTime() + 6 * 60_000);
  });
  await expect(cleanupMemoryEvalArtifacts()).rejects.toThrow(
    "exceeded its deadline"
  );
  expect(boundary.del).toHaveBeenCalledTimes(1);
  expect(await database.select().from(schema.memoryArtifacts)).toHaveLength(1);
});

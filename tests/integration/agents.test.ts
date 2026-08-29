import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import { agentManifestContentDigest } from "@/lib/agent-manifest";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("workspace-owned agents", () => {
  it("isolates agents and revisions between workspaces", async () => {
    const { agents, alice, bob, database } = await loadAgentsService();
    const aliceAgent = await agents.createAgent(alice, { slug: "assistant" });
    const aliceRevision = await agents.createRevision(
      alice,
      aliceAgent.id,
      manifest
    );
    const bobAgent = await agents.createAgent(bob, { slug: "assistant" });
    const bobRevision = await agents.createRevision(bob, bobAgent.id, manifest);

    expect(await agents.getAgent(bob, aliceAgent.id)).toBeUndefined();
    expect(await agents.listAgents(bob)).toEqual([bobAgent]);
    expect(await agents.listRevisions(bob, aliceAgent.id)).toEqual([]);
    await expect(
      agents.createRevision(bob, aliceAgent.id, manifest)
    ).rejects.toThrow("Agent not found.");
    expect(await agents.archiveAgent(bob, aliceAgent.id)).toBeUndefined();
    await expect(
      agents.publishRevision(bob, bobAgent.id, aliceRevision.id)
    ).rejects.toThrow(/revision does not belong to this agent/i);
    await expect(
      agents.rollback(bob, bobAgent.id, aliceRevision.id)
    ).rejects.toThrow(/revision does not belong to this agent/i);
    await expect(
      agents.publishRevision(alice, aliceAgent.id, bobRevision.id)
    ).rejects.toThrow(/revision does not belong to this agent/i);

    const aliceSecondAgent = await agents.createAgent(alice, {
      slug: "second-assistant",
    });
    const aliceSecondRevision = await agents.createRevision(
      alice,
      aliceSecondAgent.id,
      manifest
    );
    await expect(
      database.exec(`
        UPDATE agents
        SET active_revision_id = '${aliceSecondRevision.id}'
        WHERE id = '${aliceAgent.id}'
      `)
    ).rejects.toThrow(/foreign key/i);
  });

  it("publishes and rolls back without mutating immutable revisions", async () => {
    const { agents, alice } = await loadAgentsService();
    const agent = await agents.createAgent(alice, { slug: "assistant" });
    const first = await agents.createRevision(alice, agent.id, manifest);
    const second = await agents.createRevision(alice, agent.id, {
      ...manifest,
      instructions: "A changed instruction set.",
    });

    await agents.publishRevision(alice, agent.id, first.id);
    expect((await agents.getAgent(alice, agent.id))?.activeRevision?.id).toBe(
      first.id
    );
    await agents.publishRevision(alice, agent.id, second.id);
    await agents.rollback(alice, agent.id, first.id);

    const revisions = await agents.listRevisions(alice, agent.id);
    expect((await agents.getAgent(alice, agent.id))?.activeRevision?.id).toBe(
      first.id
    );
    expect(revisions).toEqual([first, second]);
  });

  it("increments revision numbers and lets the database reject duplicates", async () => {
    const { agents, alice, database } = await loadAgentsService();
    const agent = await agents.createAgent(alice, { slug: "assistant" });
    const first = await agents.createRevision(alice, agent.id, manifest);
    const second = await agents.createRevision(alice, agent.id, manifest);

    expect([first.revisionNumber, second.revisionNumber]).toEqual([1, 2]);
    await expect(
      database.exec(`
        INSERT INTO agent_revisions (
          id, workspace_id, agent_id, revision_number, manifest,
          content_digest, created_by_user_id, created_at
        ) VALUES (
          'duplicate-revision', 'workspace:alice', '${agent.id}', 2,
          '{"version":1,"instructions":"x","capabilities":[]}',
          'digest', 'alice', '2026-01-01'
        )
      `)
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects invalid manifests before writing a revision", async () => {
    const { agents, alice } = await loadAgentsService();
    const agent = await agents.createAgent(alice, { slug: "assistant" });

    await expect(
      agents.createRevision(alice, agent.id, {
        ...manifest,
        capabilities: [42],
      })
    ).rejects.toThrow(/expected string/i);
    await expect(
      agents.createRevision(alice, agent.id, { ...manifest, instructions: "" })
    ).rejects.toThrow(/too small/i);
    await expect(
      agents.createRevision(alice, agent.id, {
        ...manifest,
        capabilities: Array.from({ length: 101 }, () => "calendar.read"),
      })
    ).rejects.toThrow(/too big/i);
    expect(await agents.listRevisions(alice, agent.id)).toEqual([]);
  });

  it("normalizes stored manifests before deriving stable digests", async () => {
    const { agents, alice } = await loadAgentsService();
    const agent = await agents.createAgent(alice, { slug: "assistant" });
    const first = await agents.createRevision(alice, agent.id, {
      ...manifest,
      displayName: undefined,
    });
    const second = await agents.createRevision(alice, agent.id, manifest);
    const [stored] = await agents.listRevisions(alice, agent.id);
    if (!stored) throw new Error("Expected a stored revision.");

    expect(stored.contentDigest).toBe(
      agentManifestContentDigest(stored.manifest)
    );
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.createdByUserId).toBe("alice");
  });

  it("rejects invalid slugs and never reactivates archived agents", async () => {
    const { agents, alice } = await loadAgentsService();
    await expect(agents.createAgent(alice, { slug: "" })).rejects.toThrow(
      /invalid string/i
    );
    const agent = await agents.createAgent(alice, { slug: "assistant" });
    const revision = await agents.createRevision(alice, agent.id, manifest);

    await agents.archiveAgent(alice, agent.id);
    await expect(
      agents.publishRevision(alice, agent.id, revision.id)
    ).rejects.toThrow("Agent is archived.");
    expect((await agents.getAgent(alice, agent.id))?.status).toBe("archived");
  });
});

const manifest = {
  capabilities: ["calendar.read"],
  instructions: "Be helpful.",
  modelPolicy: { tier: "standard" },
  version: 1,
};

async function loadAgentsService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const pgliteDatabase = drizzle(client, { schema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  const agents = await import("@/db/services/agents");
  const scope = await import("@/db/services/scope");
  const alice = { userId: "alice", workspaceId: "workspace:alice" };
  const bob = { userId: "bob", workspaceId: "workspace:bob" };
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  return { agents, alice, bob, database: client };
}

async function applyAllMigrations(database: PGlite) {
  const names = (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { createRealPostgres } from "../harness/real-postgres";

const realPostgres = await createRealPostgres();

afterAll(async () => {
  await realPostgres?.close();
});

describe.skipIf(realPostgres === undefined)(
  "real Postgres concurrency (requires Docker Compose)",
  () => {
    it("serializes revision creation and retries concurrent phone verification", async () => {
      if (!realPostgres) throw new Error("Real Postgres was not initialized.");
      const pool = new Pool({
        connectionString: realPostgres.connectionString,
      });
      const database = drizzle({ client: pool, schema });
      vi.doMock("@/db", () => ({ ...schema, db: database }));

      try {
        const agents = await import("@/db/services/agents");
        const phoneIdentities = await import("@/db/services/phone-identities");
        const scopeService = await import("@/db/services/scope");
        const scope = { userId: "alice", workspaceId: "workspace:real-pg" };
        await scopeService.ensureScope(scope);
        await pool.query(
          'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
          ["alice", "Alice", "alice@real-postgres.test"]
        );

        const agent = await agents.createAgent(scope, { slug: "assistant" });
        const connections = await Promise.all([pool.connect(), pool.connect()]);
        connections.forEach((connection) => {
          connection.release();
        });
        const revisions = await Promise.all([
          agents.createRevision(scope, agent.id, manifest),
          agents.createRevision(scope, agent.id, manifest),
        ]);
        expect(
          revisions
            .map((revision) => revision.revisionNumber)
            .sort((left, right) => left - right)
        ).toEqual([1, 2]);

        await expect(
          Promise.all([
            phoneIdentities.recordVerifiedPhoneIdentity({
              phoneNumber: "+12025550123",
              userId: "alice",
            }),
            phoneIdentities.recordVerifiedPhoneIdentity({
              phoneNumber: "+12025550123",
              userId: "alice",
            }),
          ])
        ).resolves.toHaveLength(2);
        const { rows } = await pool.query(
          "SELECT id FROM phone_identities WHERE status = 'verified'"
        );
        expect(rows).toHaveLength(1);
      } finally {
        vi.doUnmock("@/db");
        vi.resetModules();
        await pool.end();
      }
    });
  }
);

const manifest = {
  capabilities: ["calendar.read"],
  instructions: "Be helpful.",
  modelPolicy: { tier: "standard" },
  version: 1,
};

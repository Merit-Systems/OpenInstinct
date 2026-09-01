/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  resetDatabaseForIntegrationTest,
  setDatabaseForIntegrationTest,
} from "@/db";
import {
  resetScopeEnforcementForIntegrationTest,
  setScopeEnforcementForIntegrationTest,
} from "@/db/services/scope";
import {
  resetWorkspaceScopeEnforcementForIntegrationTest,
  setWorkspaceScopeEnforcementForIntegrationTest,
} from "@/env";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];
const agentResponseSchema = z.object({ data: z.object({ id: z.string() }) });
type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
afterEach(async () => {
  resetDatabaseForIntegrationTest();
  resetScopeEnforcementForIntegrationTest();
  resetWorkspaceScopeEnforcementForIntegrationTest();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("/v1 platform API", () => {
  it("returns 401 for absent or bad keys and 403 for a missing scope", async () => {
    const api = await loadApi();
    await expect(
      api.agents.GET(new Request("http://test/v1/agents"))
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      api.agents.GET(request("/v1/agents", "oi_bad"))
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      api.agents.GET(request("/v1/agents", api.usageKey))
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      api.agents.GET(request("/v1/agents", api.agentKey.toLowerCase()))
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      api.agents.GET(
        request("/v1/agents", api.agentKey, undefined, {
          authorization: `bearer ${api.agentKey}`,
        })
      )
    ).resolves.toMatchObject({ status: 200 });
  });

  it("pins write scopes and revision/publish routes, including replay and cross-tenant 404", async () => {
    const api = await loadApi();
    const created = await createAgent(api, "revision-agent", "agent-key");
    const context = { params: Promise.resolve({ agentId: created }) };
    const revisionContext = {
      params: Promise.resolve({ agentId: created, revisionId: "missing" }),
    };
    for (const handler of [
      () =>
        api.agents.POST(
          request(
            "/v1/agents",
            api.readKey,
            { slug: "no" },
            { "idempotency-key": "no" }
          )
        ),
      () =>
        api.revisions.POST(
          request(`/v1/agents/${created}/revisions`, api.readKey, manifest, {
            "idempotency-key": "no",
          }),
          context
        ),
      () =>
        api.publish.POST(
          request(
            `/v1/agents/${created}/revisions/missing/publish`,
            api.readKey,
            {}
          ),
          revisionContext
        ),
    ])
      expect((await handler()).status).toBe(403);
    const first = await api.revisions.POST(
      request(`/v1/agents/${created}/revisions`, api.agentKey, manifest, {
        "idempotency-key": "revision-key",
      }),
      context
    );
    const replay = await api.revisions.POST(
      request(`/v1/agents/${created}/revisions`, api.agentKey, manifest, {
        "idempotency-key": "revision-key",
      }),
      context
    );
    const revisionId = agentResponseSchema.parse(await first.json()).data.id;
    expect(first.status).toBe(201);
    expect(agentResponseSchema.parse(await replay.json()).data.id).toBe(
      revisionId
    );
    expect(
      (
        await api.publish.POST(
          request(
            `/v1/agents/${created}/revisions/${revisionId}/publish`,
            api.agentKey,
            {}
          ),
          { params: Promise.resolve({ agentId: created, revisionId }) }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await api.revisions.POST(
          request(
            `/v1/agents/${created}/revisions`,
            api.otherTenantWriteKey,
            manifest,
            { "idempotency-key": "other" }
          ),
          context
        )
      ).status
    ).toBe(404);
  });

  it("reserves idempotency before create: concurrent calls do not duplicate and failed reservations retry", async () => {
    const api = await loadApi();
    const agentId = await createAgent(api, "concurrent-agent", "agent-key");
    const context = { params: Promise.resolve({ agentId }) };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        api.revisions.POST(
          request(`/v1/agents/${agentId}/revisions`, api.agentKey, manifest, {
            "idempotency-key": "same",
          }),
          context
        )
      )
    );
    expect(
      responses
        .map((response) => response.status)
        .every((status) => status === 201 || status === 409)
    ).toBe(true);
    expect(
      await api.client.query(
        "SELECT count(*)::int AS count FROM agent_revisions WHERE agent_id = '" +
          agentId +
          "'"
      )
    ).toMatchObject({ rows: [{ count: 1 }] });
    const helper = await import("@/lib/api/v1-auth");
    const route = `/v1/agents/${agentId}/revisions`;
    await helper.reserveIdempotencyKey(api.alice.workspaceId, route, "crashed");
    expect(
      (
        await api.revisions.POST(
          request(route, api.agentKey, manifest, {
            "idempotency-key": "crashed",
          }),
          context
        )
      ).status
    ).toBe(409);
    await helper.releaseIdempotencyReservation(
      api.alice.workspaceId,
      route,
      "crashed"
    );
    expect(
      (
        await api.revisions.POST(
          request(route, api.agentKey, manifest, {
            "idempotency-key": "crashed",
          }),
          context
        )
      ).status
    ).toBe(201);
  });

  it("maps duplicate slugs, archived publishes, and unknown errors without leaking details", async () => {
    const api = await loadApi();
    await createAgent(api, "conflict", "first");
    const duplicate = await api.agents.POST(
      request(
        "/v1/agents",
        api.agentKey,
        { slug: "conflict" },
        { "idempotency-key": "second" }
      )
    );
    expect(await duplicate.json()).toMatchObject({
      error: { code: "conflict" },
    });
    expect(duplicate.status).toBe(409);
    const id = await createAgent(api, "archived", "third");
    const revision = await api.revisions.POST(
      request(`/v1/agents/${id}/revisions`, api.agentKey, manifest, {
        "idempotency-key": "fourth",
      }),
      { params: Promise.resolve({ agentId: id }) }
    );
    const revisionId = agentResponseSchema.parse(await revision.json()).data.id;
    const agentsService = await import("@/db/services/agents");
    await agentsService.archiveAgent(api.alice, id);
    expect(
      (
        await api.publish.POST(
          request(
            `/v1/agents/${id}/revisions/${revisionId}/publish`,
            api.agentKey,
            {}
          ),
          { params: Promise.resolve({ agentId: id, revisionId }) }
        )
      ).status
    ).toBe(409);
    const helper = await import("@/lib/api/v1-auth");
    const unknown = helper.apiErrorFor(
      new Error("private database detail"),
      "request-id"
    );
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({
      error: { code: "internal_error", message: "An internal error occurred." },
    });
  });

  it("enforces revoked memberships and suspended workspaces when enabled", async () => {
    const api = await loadApi(true);
    await api.client.exec(
      "UPDATE workspace_memberships SET status = 'revoked' WHERE workspace_id = 'workspace:alice' AND user_id = 'alice'"
    );
    expect(
      (await api.agents.GET(request("/v1/agents", api.agentKey))).status
    ).toBe(401);
    await api.client.exec(
      "UPDATE workspace_memberships SET status = 'active' WHERE workspace_id = 'workspace:alice' AND user_id = 'alice'"
    );
    await api.client.exec(
      "UPDATE workspaces SET lifecycle_state = 'suspended' WHERE id = 'workspace:alice'"
    );
    expect(
      (await api.agents.GET(request("/v1/agents", api.agentKey))).status
    ).toBe(401);
  });

  it("creates and reads agents with replay-safe idempotency and tenant-shaped 404s", async () => {
    const api = await loadApi();
    const first = await api.agents.POST(
      request(
        "/v1/agents",
        api.agentKey,
        { slug: "platform-agent" },
        { "idempotency-key": "key-1" }
      )
    );
    const replay = await api.agents.POST(
      request(
        "/v1/agents",
        api.agentKey,
        { slug: "changed" },
        { "idempotency-key": "key-1" }
      )
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const firstBody = agentResponseSchema.parse(await first.json());
    const replayBody = agentResponseSchema.parse(await replay.json());
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(
      (await api.agents.GET(request("/v1/agents", api.agentKey))).status
    ).toBe(200);
    expect(
      await api.client.query("SELECT count(*)::int AS count FROM agents")
    ).toMatchObject({ rows: [{ count: 1 }] });
    const missing = await api.agent.GET(
      request(`/v1/agents/${firstBody.data.id}`, api.otherTenantKey),
      { params: Promise.resolve({ agentId: firstBody.data.id }) }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "not_found" },
    });
    expect(
      (
        await api.agents.POST(
          request("/v1/agents", api.agentKey, { slug: "no-key" })
        )
      ).status
    ).toBe(400);
  });

  it("returns current-month per-kind usage", async () => {
    const api = await loadApi();
    const usage = await import("@/db/services/usage");
    await usage.recordUsageEvent(api.alice, {
      kind: "model_tokens",
      quantity: 12,
      unit: "tokens",
    });
    const response = await api.usage.GET(request("/v1/usage", api.usageKey));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { totals: { model_tokens: 12, browser_session: 0 } },
    });
  });
});

function request(
  path: string,
  key?: string,
  body?: JsonValue,
  headers: Readonly<Record<string, string>> = {}
) {
  const requestHeaders = new Headers();
  if (key) requestHeaders.set("authorization", `Bearer ${key}`);
  if (body !== undefined)
    requestHeaders.set("content-type", "application/json");
  for (const [name, value] of Object.entries(headers)) {
    requestHeaders.set(name, value);
  }
  return new Request(`http://test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const manifest = {
  capabilities: ["calendar.read"],
  instructions: "Hello",
  modelPolicy: { tier: "standard" },
  version: 1,
};

async function createAgent(
  api: Awaited<ReturnType<typeof loadApi>>,
  slug: string,
  idempotencyKey: string
) {
  const response = await api.agents.POST(
    request(
      "/v1/agents",
      api.agentKey,
      { slug },
      { "idempotency-key": idempotencyKey }
    )
  );
  return agentResponseSchema.parse(await response.json()).data.id;
}

async function loadApi(enforcementEnabled = false) {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const database = drizzle(client, { schema });
  setDatabaseForIntegrationTest(database);
  setScopeEnforcementForIntegrationTest(() => enforcementEnabled);
  setWorkspaceScopeEnforcementForIntegrationTest(() => enforcementEnabled);
  const scope = await import("@/db/services/scope");
  const credentials = await import("@/db/services/api-credentials");
  const alice = { userId: "alice", workspaceId: "workspace:alice" };
  const bob = { userId: "bob", workspaceId: "workspace:bob" };
  await scope.ensureScope(alice);
  await scope.ensureScope(bob);
  const agentKey = (
    await credentials.mintApiCredential(alice, {
      name: "agents",
      scopes: ["agents:read", "agents:write"],
    })
  ).secret;
  const usageKey = (
    await credentials.mintApiCredential(alice, {
      name: "usage",
      scopes: ["usage:read"],
    })
  ).secret;
  const otherTenantKey = (
    await credentials.mintApiCredential(bob, {
      name: "other",
      scopes: ["agents:read"],
    })
  ).secret;
  const otherTenantWriteKey = (
    await credentials.mintApiCredential(bob, {
      name: "other-write",
      scopes: ["agents:write"],
    })
  ).secret;
  const readKey = (
    await credentials.mintApiCredential(alice, {
      name: "read",
      scopes: ["agents:read"],
    })
  ).secret;
  const agents = await import("@/app/v1/agents/route");
  const agent = await import("@/app/v1/agents/[agentId]/route");
  const revisions = await import("@/app/v1/agents/[agentId]/revisions/route");
  const publish =
    await import("@/app/v1/agents/[agentId]/revisions/[revisionId]/publish/route");
  const usage = await import("@/app/v1/usage/route");
  return {
    agent,
    agentKey,
    agents,
    alice,
    client,
    otherTenantKey,
    otherTenantWriteKey,
    publish,
    readKey,
    revisions,
    usage,
    usageKey,
  };
}

async function applyAllMigrations(database: PGlite) {
  for (const name of (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint"))
      if (statement.trim()) await database.exec(statement);
  }
}

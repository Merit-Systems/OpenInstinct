import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import Kernel from "@onkernel/sdk";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { ToolContext } from "eve/tools";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import * as Database from "@db";
import * as schema from "@db/schema";
import {
  createBrowserSession,
  readBrowserSession,
} from "@db/services/browsers";
import { ensureScope } from "@db/services/scope";
import { claimSession } from "@db/services/sessions";
import * as KernelClient from "@agent/subagents/browser-agent/lib/kernel";
import manageBrowsers from "@agent/subagents/browser-agent/tools/manage_browsers";
import { toolContextFor } from "@tests/helpers/tool-context";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = {
  userId: "browser-fixture",
  workspaceId: "workspace:browser-fixture",
};
const requests: string[] = [];
let failedStatus = 200;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;
  requests.push(path);
  response.setHeader("content-type", "application/json");
  if (path.endsWith("browser-2") && failedStatus !== 200) {
    response.statusCode = failedStatus;
    response.end(JSON.stringify({ message: "Provider unavailable" }));
    return;
  }
  if (
    path.endsWith("browser-deleted") &&
    url.searchParams.get("include_deleted") === "false"
  ) {
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Browser not found" }));
    return;
  }
  response.end(
    JSON.stringify({
      browser_live_view_url: "https://example.com/view",
      deleted_at: path.endsWith("browser-deleted")
        ? "2026-10-01T12:00:00Z"
        : null,
      session_id: path.split("/").at(-1),
    })
  );
});

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite supplies the real Drizzle query-builder contract; only the driver changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Keep the committed migrations, real ownership checks and real session queries.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  vi.spyOn(KernelClient, "kernel", "get").mockReturnValue(
    new Kernel({
      apiKey: "fixture-key",
      maxRetries: 0,
      baseURL: `http://127.0.0.1:${String(address.port)}`,
    })
  );
}, 20_000);

beforeEach(async () => {
  requests.length = 0;
  failedStatus = 200;
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  await claimSession(scope, "parent-fixture");
  await claimSession(scope, "worker-fixture");
  await Promise.all(
    ["browser-1", "browser-2", "browser-3", "browser-deleted"].map(
      (sessionId, index) =>
        createBrowserSession(scope, {
          createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, index)).toISOString(),
          sessionId,
          workerSessionId: "worker-fixture",
        })
    )
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
});

describe("browser list responses", () => {
  it.each([401, 503])(
    "surfaces provider HTTP %i without deleting its owned session",
    async (status) => {
      failedStatus = status;
      await expect(
        manageBrowsers.execute({ action: "list" }, context())
      ).rejects.toMatchObject({ status });
      await expect(
        readBrowserSession(scope, "browser-2")
      ).resolves.toMatchObject({
        sessionId: "browser-2",
      });
    }
  );

  it("preserves SDK cancellation instead of returning an empty list", async () => {
    await expect(
      manageBrowsers.execute(
        { action: "list" },
        { ...context(), abortSignal: AbortSignal.abort() }
      )
    ).rejects.toThrow(/aborted/iu);
    await expect(readBrowserSession(scope, "browser-2")).resolves.toMatchObject(
      {
        sessionId: "browser-2",
      }
    );
  });

  it("removes a definitive 404 stale record while listing healthy sessions", async () => {
    await expect(
      manageBrowsers.execute({ action: "list", status: "active" }, context())
    ).resolves.toMatchObject({
      items: [
        { session_id: "browser-3" },
        { session_id: "browser-2" },
        { session_id: "browser-1" },
      ],
    });
    await expect(
      readBrowserSession(scope, "browser-deleted")
    ).resolves.toBeUndefined();
  });

  it("reports the next offset when matching owned sessions exceed the limit", async () => {
    await expect(
      manageBrowsers.execute(
        { action: "list", limit: 2, status: "active" },
        context()
      )
    ).resolves.toMatchObject({
      has_more: true,
      items: [{ session_id: "browser-3" }, { session_id: "browser-2" }],
      next_offset: 2,
    });
    expect(requests).toHaveLength(4);
  });

  it("reads the final page and reports no further offset", async () => {
    await expect(
      manageBrowsers.execute(
        { action: "list", limit: 2, offset: 2, status: "active" },
        context()
      )
    ).resolves.toMatchObject({
      has_more: false,
      items: [{ session_id: "browser-1" }],
      next_offset: null,
    });
  });

  it("uses filtered matches for exact limit and exhausted offset", async () => {
    await expect(
      manageBrowsers.execute(
        { action: "list", limit: 3, status: "active" },
        context()
      )
    ).resolves.toMatchObject({
      has_more: false,
      items: [
        { session_id: "browser-3" },
        { session_id: "browser-2" },
        { session_id: "browser-1" },
      ],
      next_offset: null,
    });
    await expect(
      manageBrowsers.execute(
        { action: "list", limit: 2, offset: 3, status: "active" },
        context()
      )
    ).resolves.toEqual({
      has_more: false,
      items: [],
      next_offset: null,
    });
  });

  it("includes all sessions by default and preserves workspace isolation", async () => {
    const foreignScope = {
      userId: "foreign-user",
      workspaceId: "workspace:foreign-user",
    };
    await ensureScope(foreignScope);
    await createBrowserSession(foreignScope, {
      createdAt: "2026-10-01T12:00:00Z",
      sessionId: "foreign-browser",
      workerSessionId: null,
    });
    await expect(
      manageBrowsers.execute({ action: "list" }, context())
    ).resolves.toMatchObject({
      has_more: false,
      items: [
        { session_id: "browser-deleted" },
        { session_id: "browser-3" },
        { session_id: "browser-2" },
        { session_id: "browser-1" },
      ],
      next_offset: null,
    });
    expect(requests.some((path) => path.includes("foreign-browser"))).toBe(
      false
    );
  });
});

function context() {
  const base = toolContextFor({
    sessionId: "worker-fixture",
    parentSessionId: "parent-fixture",
  });
  return {
    ...base,
    session: {
      ...base.session,
      auth: {
        current: {
          attributes: { workspaceId: scope.workspaceId },
          authenticator: "fixture",
          principalId: scope.userId,
          principalType: "user",
        },
        initiator: null,
      },
    },
  } satisfies ToolContext;
}

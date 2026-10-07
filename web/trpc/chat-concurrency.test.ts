import { PGlite } from "@electric-sql/pglite";
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
import { readChat, saveChat } from "@db/services/chats";
import { ensureScope } from "@db/services/scope";
import { claimSession } from "@db/services/sessions";
import { appRouter } from "@web/trpc/router";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "chat-fixture", workspaceId: "workspace:chat-fixture" };
const caller = appRouter.createCaller({ origin: "https://example.com", scope });

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite supplies the real Drizzle query-builder contract used by the service; only the database driver changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise the committed migrations and real services against an isolated PostgreSQL-compatible database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);

beforeEach(async () => {
  await database.delete(schema.workspaces);
  await ensureScope(scope);
  await claimSession(scope, "chat-session");
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("chat indexing", () => {
  it("preserves title and usage when the first UI saves overlap", async () => {
    await Promise.all([
      caller.chats.save({ sessionId: "chat-session", title: "Travel plans" }),
      caller.chats.save({
        sessionId: "chat-session",
        usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
      }),
    ]);
    expect(await readChat(scope, "chat-session")).toMatchObject({
      title: "Travel plans",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
  });

  it("preserves sparse fields during sequential saves and denies another workspace", async () => {
    await caller.chats.save({
      sessionId: "chat-session",
      title: "Travel plans",
    });
    await saveChat(scope, { channel: "http", sessionId: "chat-session" });
    await caller.chats.save({
      sessionId: "chat-session",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
    const before = await readChat(scope, "chat-session");
    expect(before).toMatchObject({
      channel: "http",
      title: "Travel plans",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
    await appRouter
      .createCaller({
        origin: "https://example.com",
        scope: { userId: "other-user", workspaceId: "workspace:other-user" },
      })
      .chats.save({ sessionId: "chat-session", title: "Other title" });
    expect(await readChat(scope, "chat-session")).toEqual(before);
  });
});

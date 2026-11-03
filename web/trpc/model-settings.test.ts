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
import { getGatewayModel } from "@db/services/settings";
import { ensureScope } from "@db/services/scope";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { appRouter } from "./router";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = accessScopeForUser("first-model-selection");
const caller = appRouter.createCaller({ origin: "https://example.com", scope });
const defaultModel = "openai/gpt-6.1-sol-fast";

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite implements the real Drizzle query-builder contract; only the database driver is replaced.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Real committed migrations and real tRPC/service caller use an owned PostgreSQL-compatible database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);

beforeEach(async () => {
  await database.delete(schema.workspaces);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("workspace model selection", () => {
  it("saves the first model selection before a chat or vault initializes the workspace", async () => {
    expect(await getGatewayModel(scope)).toBe(defaultModel);
    expect(await database.select().from(schema.workspaces)).toHaveLength(0);
    await caller.settings.selectModel({ modelId: defaultModel });
    expect(await database.select().from(schema.settings)).toMatchObject([
      { value: defaultModel, workspaceId: scope.workspaceId },
    ]);
    expect(
      await database.select().from(schema.workspaceMemberships)
    ).toMatchObject([{ userId: scope.userId, workspaceId: scope.workspaceId }]);
  });

  it("still updates an already initialized workspace without duplicate rows", async () => {
    await ensureScope(scope);
    await caller.settings.selectModel({ modelId: defaultModel });
    await caller.settings.selectModel({ modelId: "meta/muse-spark-1.3" });
    expect(await getGatewayModel(scope)).toBe("meta/muse-spark-1.3");
    expect(await database.select().from(schema.settings)).toHaveLength(1);
    expect(
      await database.select().from(schema.workspaceMemberships)
    ).toHaveLength(1);
  });
});

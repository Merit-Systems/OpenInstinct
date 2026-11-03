import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { MemoryToolsContext } from "eve/memory";
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
  patchUserProfile,
  readUserProfile,
  replaceUserProfile,
} from "@db/services/user-profile";
import personalInfoMemory from "@agent/memory/personal_info";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { emptyUserProfile } from "@shared/user-profile/schema";
import { toolContextFor } from "@tests/helpers/tool-context";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = accessScopeForUser("profile-fixture");

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: PGlite supplies the real Drizzle query-builder contract used by the service; only the database driver changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Exercise the real migrations and service against an isolated PostgreSQL-compatible database.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);

beforeEach(async () => {
  await database.delete(schema.workspaces);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("Personal Info field updates", () => {
  it("preserves unrelated fields when two conversations update an existing profile", async () => {
    await replaceUserProfile(scope, { ...emptyUserProfile, firstName: "Ada" });
    const firstTools = await personalInfoMemory.provider.tools(
      memoryContext("city-session")
    );
    const secondTools = await personalInfoMemory.provider.tools(
      memoryContext("region-session")
    );
    if (!firstTools || !secondTools)
      throw new Error("Expected the interactive profile update tool.");
    await Promise.all([
      firstTools.update.execute(
        { city: "London" },
        toolContextFor({ callId: "city", sessionId: "city-session" })
      ),
      secondTools.update.execute(
        { region: "Greater London" },
        toolContextFor({ callId: "region", sessionId: "region-session" })
      ),
    ]);
    expect(await readUserProfile(scope)).toMatchObject({
      city: "London",
      firstName: "Ada",
      region: "Greater London",
    });
  });

  it("preserves both fields when concurrent patches create the first profile", async () => {
    await Promise.all([
      patchUserProfile(scope, { firstName: "Ada" }),
      patchUserProfile(scope, { lastName: "Lovelace" }),
    ]);
    expect(await readUserProfile(scope)).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("normalizes values and removes only an explicitly cleared field", async () => {
    await replaceUserProfile(scope, {
      ...emptyUserProfile,
      city: "London",
      firstName: "Ada",
    });
    expect(
      await patchUserProfile(scope, { countryCode: " gb ", firstName: null })
    ).toMatchObject({
      city: "London",
      countryCode: "GB",
      firstName: null,
    });
  });

  it("creates a normalized profile without changing replacement semantics", async () => {
    expect(
      await patchUserProfile(scope, { firstName: " Ada ", countryCode: "gb" })
    ).toMatchObject({
      countryCode: "GB",
      firstName: "Ada",
      lastName: null,
    });
    expect(
      await replaceUserProfile(scope, {
        ...emptyUserProfile,
        lastName: "Lovelace",
      })
    ).toMatchObject({
      countryCode: null,
      firstName: null,
      lastName: "Lovelace",
    });
  });
});

function memoryContext(sessionId: string): MemoryToolsContext {
  return {
    channel: {},
    memory: {
      scope: {
        key: "profile-key",
        namespace: "openinstinct-personal-info-v1",
        value: scope.workspaceId,
      },
      slot: "personal_info",
    },
    messages: [],
    model: null,
    session: {
      auth: {
        current: {
          attributes: { workspaceId: scope.workspaceId },
          authenticator: "fixture",
          principalId: scope.userId,
          principalType: "user",
        },
        initiator: null,
      },
      id: sessionId,
    },
    turn: { id: "profile-turn", input: [], sequence: 1 },
  };
}

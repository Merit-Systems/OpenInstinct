import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetDatabaseForIntegrationTest,
  setDatabaseForIntegrationTest,
} from "@/db";
import { adminDependencies } from "@/lib/admin";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  resetDatabaseForIntegrationTest();
  adminDependencies.adminPhoneNumbers = () => "";
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("requireAdminScopeFor", () => {
  it("permits only an allowlisted Better Auth user", async () => {
    const service = await loadGate("+12025550123");
    await service.client.exec(`
      INSERT INTO "user" (id, name, email, "phoneNumber") VALUES
        ('allowlisted', 'Allowlisted', 'allowlisted@example.test', '+12025550123'),
        ('non-admin', 'Non Admin', 'non-admin@example.test', '+12025550124');
    `);

    const allowed = { userId: "better-auth:allowlisted", workspaceId: "w" };
    await expect(service.requireAdminScopeFor(allowed)).resolves.toEqual(
      allowed
    );
    await expect(
      service.requireAdminScopeFor({
        userId: "better-auth:non-admin",
        workspaceId: "w",
      })
    ).rejects.toBeInstanceOf(service.AdminNotFoundError);
    await expect(
      service.requireAdminScopeFor({
        userId: "better-auth:unknown",
        workspaceId: "w",
      })
    ).rejects.toBeInstanceOf(service.AdminNotFoundError);
    await expect(
      service.requireAdminScopeFor({ userId: "allowlisted", workspaceId: "w" })
    ).rejects.toBeInstanceOf(service.AdminNotFoundError);
  });

  it.each(["", undefined])(
    "denies every user when the allowlist is %j",
    async (allowlist) => {
      const service = await loadGate(allowlist);
      await service.client.exec(
        `INSERT INTO "user" (id, name, email, "phoneNumber") VALUES ('allowlisted', 'Allowlisted', 'allowlisted@example.test', '+12025550123')`
      );

      await expect(
        service.requireAdminScopeFor({
          userId: "better-auth:allowlisted",
          workspaceId: "w",
        })
      ).rejects.toBeInstanceOf(service.AdminNotFoundError);
    }
  );
});

async function loadGate(ADMIN_PHONE_NUMBERS: string | undefined) {
  const client = new PGlite();
  databases.push(client);
  for (const migrationName of (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migration files must execute in committed order.
    const migration = await readFile(
      new URL(`../../db/migrations/${migrationName}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Migration statements must execute in committed order.
        await client.exec(statement);
      }
    }
  }
  const database = drizzle(client, { schema });
  setDatabaseForIntegrationTest(database);
  adminDependencies.adminPhoneNumbers = () => ADMIN_PHONE_NUMBERS ?? "";
  return { ...(await import("@/lib/admin")), client };
}

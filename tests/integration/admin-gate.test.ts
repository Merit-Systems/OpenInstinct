/* oxlint-disable typescript/no-unsafe-type-assertion -- PGlite is the adapter-compatible database test double used by the integration suite. */
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import * as schema from "../../db/schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/env");
  vi.resetModules();
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
  for (const name of (
    await readdir(new URL("../../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = await readFile(
      new URL(`../../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  const database = drizzle(client, { schema }) as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  vi.doMock("@/lib/env", () => ({
    env: { ADMIN_PHONE_NUMBERS },
    localPhoneAuthBypassEnabled: false,
  }));
  return { ...(await import("@/lib/admin")), client };
}

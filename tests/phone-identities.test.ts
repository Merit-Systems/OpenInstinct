import { createHmac, hkdfSync } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { db } from "@/db";
import * as schema from "../db/schema";

const databases: PGlite[] = [];
const phoneNumber = "+12025550123";
const normalizedPhoneNumber = "+12025550123";
const testSecretEncryptionKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

afterEach(async () => {
  vi.doUnmock("@/db");
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("phone identities", () => {
  it("stores an encrypted, hash-addressable verified identity", async () => {
    const { phoneIdentities, service } = await loadPhoneIdentityService();

    const identity = await service.recordVerifiedPhoneIdentity({
      phoneNumber,
      userId: "alice",
    });

    expect(identity.encryptedPhoneNumber).toMatch(
      /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/
    );
    expect(identity.phoneLookupHash).toBe(expectedLookupHash());
    expect(
      service.decryptPhoneIdentityForTest(
        identity.id,
        identity.encryptedPhoneNumber
      )
    ).toBe(normalizedPhoneNumber);
    expect(() =>
      service.decryptPhoneIdentityForTest(
        "different-row-id",
        identity.encryptedPhoneNumber
      )
    ).toThrow(/authenticate/i);
    expect(identity.status).toBe("verified");
    expect(await service.findVerifiedUserByPhoneNumber(phoneNumber)).toEqual({
      phoneIdentityId: identity.id,
      userId: "alice",
    });
    expect(await phoneIdentities()).toHaveLength(1);
  });

  it("refreshes a same-user verification without creating another row", async () => {
    const { client, phoneIdentities, service } =
      await loadPhoneIdentityService();
    const first = await service.recordVerifiedPhoneIdentity({
      phoneNumber,
      userId: "alice",
    });
    await client.exec(`
      UPDATE phone_identities
      SET verified_at = '2000-01-01T00:00:00.000Z'
      WHERE id = '${first.id}'
    `);

    const refreshed = await service.recordVerifiedPhoneIdentity({
      phoneNumber: "202-555-0123",
      userId: "alice",
    });

    expect(refreshed.id).toBe(first.id);
    expect(refreshed.verifiedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(await phoneIdentities()).toHaveLength(1);
  });

  it("recycles the previous verified identity when a number moves users", async () => {
    const { phoneIdentities, service } = await loadPhoneIdentityService();
    const original = await service.recordVerifiedPhoneIdentity({
      phoneNumber,
      userId: "alice",
    });
    const replacement = await service.recordVerifiedPhoneIdentity({
      phoneNumber,
      userId: "bob",
    });

    const rows = await phoneIdentities();
    const recycled = rows.find((row) => row.id === original.id);
    const verified = rows.find((row) => row.id === replacement.id);
    if (!recycled || !verified)
      throw new Error("Expected both phone identities.");
    expect(recycled.userId).toBe("alice");
    expect(recycled.status).toBe("recycled");
    expect(recycled.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(verified).toMatchObject({
      revokedAt: null,
      status: "verified",
      userId: "bob",
    });
    expect(await service.findVerifiedUserByPhoneNumber(phoneNumber)).toEqual({
      phoneIdentityId: replacement.id,
      userId: "bob",
    });
  });

  it("lets the database reject a second verified row for the lookup hash", async () => {
    const { client, service } = await loadPhoneIdentityService();
    const identity = await service.recordVerifiedPhoneIdentity({
      phoneNumber,
      userId: "alice",
    });

    await expect(
      client.exec(`
        INSERT INTO phone_identities (
          id, user_id, encrypted_phone_number, phone_lookup_hash, status, verified_at
        ) VALUES (
          'duplicate', 'bob', 'v1.test.test.test', '${identity.phoneLookupHash}',
          'verified', '2026-01-01T00:00:00.000Z'
        )
      `)
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("does not find a revoked identity", async () => {
    const { service } = await loadPhoneIdentityService();
    await service.recordVerifiedPhoneIdentity({ phoneNumber, userId: "alice" });

    await expect(
      service.revokePhoneIdentity("alice", phoneNumber)
    ).resolves.toBe(true);
    await expect(
      service.findVerifiedUserByPhoneNumber(phoneNumber)
    ).resolves.toBeUndefined();
  });

  it("retries once when a concurrent verified insert wins the partial index", async () => {
    const conflict = Object.assign(new Error("unique conflict"), {
      cause: { code: "23505" },
    });
    const retriedIdentity = { id: "retried-identity" };
    const transaction = vi
      .fn<(operation: () => Promise<unknown>) => Promise<unknown>>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(retriedIdentity);
    vi.doMock("@/db", () => ({ db: { transaction }, phoneIdentities: {} }));
    const service = await import("@/db/services/phone-identities");

    await expect(
      service.recordVerifiedPhoneIdentity({ phoneNumber, userId: "alice" })
    ).resolves.toBe(retriedIdentity);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});

function expectedLookupHash() {
  const masterKey = Buffer.from(testSecretEncryptionKey, "base64");
  const hmacKey = Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), "phone-identity-hmac", 32)
  );
  return createHmac("sha256", hmacKey)
    .update(normalizedPhoneNumber, "utf8")
    .digest("hex");
}

async function loadPhoneIdentityService() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  await client.exec(`
    INSERT INTO "user" (id, name, email)
    VALUES
      ('alice', 'Alice', 'alice@example.test'),
      ('bob', 'Bob', 'bob@example.test')
  `);
  const pgliteDatabase = drizzle(client, { schema });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter-compatible integration test double
  const database = pgliteDatabase as unknown as typeof db;
  vi.doMock("@/db", () => ({ ...schema, db: database }));
  const service = await import("@/db/services/phone-identities");
  return {
    client,
    phoneIdentities: () =>
      client
        .query<{
          id: string;
          revokedAt: string | null;
          status: string;
          userId: string;
        }>(`
        SELECT id, user_id AS "userId", status, revoked_at AS "revokedAt"
        FROM phone_identities ORDER BY id
      `)
        .then((result) => result.rows),
    service,
  };
}

async function applyAllMigrations(database: PGlite) {
  const names = (await readdir(new URL("../db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const migration = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
  }
}

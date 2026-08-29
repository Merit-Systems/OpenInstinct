import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { db, phoneIdentities } from "@/db";
import { env } from "@/lib/env";
import { accessScopeForUser } from "@/lib/access-scope";
import { recordAuditEvent } from "./audit";

// This encryption guarantee covers phone_identities only; Better Auth's user
// phoneNumber storage and temporary-email derivation are tracked separately.

export async function recordVerifiedPhoneIdentity({
  phoneNumber,
  userId,
}: {
  readonly phoneNumber: string;
  readonly userId: string;
}) {
  const normalizedPhoneNumber = requireNormalizedPhoneNumber(phoneNumber);
  const phoneLookupHash = lookupHash(normalizedPhoneNumber);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await recordVerifiedPhoneIdentityTransaction({
        normalizedPhoneNumber,
        phoneLookupHash,
        userId,
      });
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new Error("Failed to record phone identity.");
}

async function recordVerifiedPhoneIdentityTransaction({
  normalizedPhoneNumber,
  phoneLookupHash,
  userId,
}: {
  readonly normalizedPhoneNumber: string;
  readonly phoneLookupHash: string;
  readonly userId: string;
}) {
  const now = new Date().toISOString();
  return await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: phoneIdentities.id, userId: phoneIdentities.userId })
      .from(phoneIdentities)
      .where(
        and(
          eq(phoneIdentities.phoneLookupHash, phoneLookupHash),
          eq(phoneIdentities.status, "verified")
        )
      )
      .for("update")
      .limit(1);

    if (existing?.userId === userId) {
      const [identity] = await transaction
        .update(phoneIdentities)
        .set({ updatedAt: now, verifiedAt: now })
        .where(eq(phoneIdentities.id, existing.id))
        .returning();
      if (!identity) throw new Error("Failed to refresh phone identity.");
      return identity;
    }

    if (existing) {
      await transaction
        .update(phoneIdentities)
        .set({ revokedAt: now, status: "recycled", updatedAt: now })
        .where(eq(phoneIdentities.id, existing.id));
    }

    const id = randomUUID();
    const [identity] = await transaction
      .insert(phoneIdentities)
      .values({
        encryptedPhoneNumber: encryptPhoneNumber(id, normalizedPhoneNumber),
        id,
        phoneLookupHash,
        userId,
        verifiedAt: now,
      })
      .returning();
    if (!identity) throw new Error("Failed to record phone identity.");
    return identity;
  });
}

export async function findVerifiedUserByPhoneNumber(phoneNumber: string) {
  const normalizedPhoneNumber = requireNormalizedPhoneNumber(phoneNumber);
  const [identity] = await db
    .select({
      phoneIdentityId: phoneIdentities.id,
      userId: phoneIdentities.userId,
    })
    .from(phoneIdentities)
    .where(
      and(
        eq(phoneIdentities.phoneLookupHash, lookupHash(normalizedPhoneNumber)),
        eq(phoneIdentities.status, "verified")
      )
    )
    .limit(1);
  return identity;
}

export async function revokePhoneIdentity(userId: string, phoneNumber: string) {
  const normalizedPhoneNumber = requireNormalizedPhoneNumber(phoneNumber);
  const now = new Date().toISOString();
  const rows = await db
    .update(phoneIdentities)
    .set({ revokedAt: now, status: "revoked", updatedAt: now })
    .where(
      and(
        eq(phoneIdentities.userId, userId),
        eq(phoneIdentities.phoneLookupHash, lookupHash(normalizedPhoneNumber)),
        eq(phoneIdentities.status, "verified")
      )
    )
    .returning({ id: phoneIdentities.id });
  const revoked = rows.length > 0;
  if (revoked) {
    // Phone revocation occurs for a provisioned Better Auth user's workspace.
    void recordAuditEvent(accessScopeForUser(`better-auth:${userId}`), {
      action: "phone.identity.revoke",
      target: rows[0]?.id,
    }).catch(() => {
      console.warn("[audit] event recording failed");
    });
  }
  return revoked;
}

function requireNormalizedPhoneNumber(phoneNumber: string) {
  const normalizedPhoneNumber = normalizeAuthPhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber)
    throw new Error("A valid phone number is required.");
  return normalizedPhoneNumber;
}

function lookupHash(phoneNumber: string) {
  return createHmac("sha256", derivedKey("phone-identity-hmac"))
    .update(phoneNumber, "utf8")
    .digest("hex");
}

function encryptPhoneNumber(id: string, phoneNumber: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derivedKey("phone-identity-aead"),
    iv
  );
  cipher.setAAD(phoneIdentityAad(id));
  const ciphertext = Buffer.concat([
    cipher.update(phoneNumber, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptPhoneIdentityForTest(id: string, value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored phone identity uses an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey("phone-identity-aead"),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAAD(phoneIdentityAad(id));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function derivedKey(info: "phone-identity-aead" | "phone-identity-hmac") {
  return Buffer.from(
    hkdfSync("sha256", encryptionKey(), Buffer.alloc(0), info, 32)
  );
}

function encryptionKey() {
  return Buffer.from(env.SECRET_ENCRYPTION_KEY, "base64");
}

function phoneIdentityAad(id: string) {
  return Buffer.from(`phone-identity\u0000${id}`);
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "23505"
  );
}

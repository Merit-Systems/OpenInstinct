import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AccessScope } from "../access-scope";
import { env } from "@/lib/env";
import { getAppStore } from "./app-store";

export function secretStoreStatus() {
  return {
    available: true,
    description:
      "Secrets are encrypted for this workspace before database storage.",
    kind: "Encrypted vault",
  };
}

export async function writeSecret({
  id,
  scope,
  value,
}: {
  readonly id: string;
  readonly namespace: "vault";
  readonly scope: AccessScope;
  readonly value: string;
}) {
  await (
    await getAppStore()
  ).writeEncryptedSecret(scope, id, encryptSecret(scope, id, value));
}

export async function readSecret({
  id,
  scope,
}: {
  readonly id: string;
  readonly namespace: "vault";
  readonly scope: AccessScope;
}) {
  const encrypted = await (await getAppStore()).readEncryptedSecret(scope, id);
  return encrypted ? decryptSecret(scope, id, encrypted) : undefined;
}

export async function hasSecret({
  id,
  scope,
}: {
  readonly id: string;
  readonly namespace: "vault";
  readonly scope: AccessScope;
}) {
  return (
    (await (await getAppStore()).readEncryptedSecret(scope, id)) !== undefined
  );
}

export async function deleteSecret({
  id,
  scope,
}: {
  readonly id: string;
  readonly namespace: "vault";
  readonly scope: AccessScope;
}) {
  await (await getAppStore()).deleteEncryptedSecret(scope, id);
}

function encryptSecret(scope: AccessScope, id: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(env.SECRET_ENCRYPTION_KEY, "base64"),
    iv
  );
  cipher.setAAD(secretAad(scope, id));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptSecret(scope: AccessScope, id: string, value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored secret uses an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(env.SECRET_ENCRYPTION_KEY, "base64"),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAAD(secretAad(scope, id));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function secretAad(scope: AccessScope, id: string) {
  return Buffer.from(`${scope.workspaceId}\u0000vault\u0000${id}`);
}

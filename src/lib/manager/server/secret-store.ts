import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  deleteEncryptedSecret,
  readEncryptedSecret,
  writeEncryptedSecret,
} from "@/db/services/secrets";
import { getInstallationSecrets } from "@/lib/installation-secrets";
import type { AccessScope } from "../../access-scope";

export const secretStoreDependencies = {
  deleteEncryptedSecret,
  getInstallationSecrets,
  readEncryptedSecret,
  writeEncryptedSecret,
};

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
  await secretStoreDependencies.writeEncryptedSecret(
    scope,
    id,
    await encryptSecret(scope, id, value)
  );
}

export async function readSecret({
  id,
  scope,
}: {
  readonly id: string;
  readonly namespace: "vault";
  readonly scope: AccessScope;
}) {
  const encrypted = await secretStoreDependencies.readEncryptedSecret(
    scope,
    id
  );
  return encrypted ? await decryptSecret(scope, id, encrypted) : undefined;
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
    (await secretStoreDependencies.readEncryptedSecret(scope, id)) !== undefined
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
  await secretStoreDependencies.deleteEncryptedSecret(scope, id);
}

async function encryptSecret(scope: AccessScope, id: string, value: string) {
  const { secretEncryptionKey } =
    await secretStoreDependencies.getInstallationSecrets();
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(secretEncryptionKey, "base64"),
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

async function decryptSecret(scope: AccessScope, id: string, value: string) {
  const { secretEncryptionKey } =
    await secretStoreDependencies.getInstallationSecrets();
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored secret uses an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secretEncryptionKey, "base64"),
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

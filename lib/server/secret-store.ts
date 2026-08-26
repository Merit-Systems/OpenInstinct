import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { AccessScope } from "../access-scope";
import { getDeploymentMode } from "../deployment-mode";
import { getEnv } from "../runtime-env";
import { getAppStore } from "./app-store";

const execFileAsync = promisify(execFile);
const securityPath = "/usr/bin/security";
const servicePrefix = "com.merit.local-vault-assistant";

export function secretStoreStatus() {
  if (getDeploymentMode() === "hosted") {
    const available = optionalHostedEncryptionKey() !== undefined;
    return {
      available,
      description: available
        ? "Secrets are encrypted for this workspace before database storage."
        : "Hosted secret encryption is not configured.",
      kind: available ? "Encrypted hosted vault" : "Unavailable",
    };
  }

  if (process.platform === "darwin") {
    return {
      available: true,
      description: "Secrets stay in the signed-in user's macOS Keychain.",
      kind: "macOS Keychain",
    };
  }

  return {
    available: false,
    description: "This host does not yet have a supported OS keychain adapter.",
    kind: "Unavailable",
  };
}

export async function writeSecret({
  id,
  namespace,
  scope,
  value,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
  readonly scope: AccessScope;
  readonly value: string;
}) {
  if (scope.mode === "hosted") {
    await (
      await getAppStore()
    ).writeEncryptedSecret(
      scope,
      namespace,
      id,
      encryptSecret(scope, namespace, id, value)
    );
    return;
  }

  assertSecretStoreAvailable();
  await execFileAsync(
    securityPath,
    [
      "add-generic-password",
      "-U",
      "-a",
      id,
      "-s",
      service(namespace),
      "-w",
      value,
    ],
    { encoding: "utf8" }
  );
}

export async function readSecret({
  id,
  namespace,
  scope,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
  readonly scope: AccessScope;
}) {
  if (scope.mode === "hosted") {
    const encrypted = await (
      await getAppStore()
    ).readEncryptedSecret(scope, namespace, id);
    return encrypted
      ? decryptSecret(scope, namespace, id, encrypted)
      : undefined;
  }

  assertSecretStoreAvailable();
  const { stdout } = await execFileAsync(
    securityPath,
    ["find-generic-password", "-a", id, "-s", service(namespace), "-w"],
    { encoding: "utf8" }
  );
  return stdout.trimEnd();
}

export async function hasSecret({
  id,
  namespace,
  scope,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
  readonly scope: AccessScope;
}) {
  if (scope.mode === "hosted") {
    return (
      (await (
        await getAppStore()
      ).readEncryptedSecret(scope, namespace, id)) !== undefined
    );
  }

  if (!secretStoreStatus().available) return false;

  try {
    await execFileAsync(
      securityPath,
      ["find-generic-password", "-a", id, "-s", service(namespace)],
      { encoding: "utf8" }
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteSecret({
  id,
  namespace,
  scope,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
  readonly scope: AccessScope;
}) {
  if (scope.mode === "hosted") {
    await (await getAppStore()).deleteEncryptedSecret(scope, namespace, id);
    return;
  }

  if (!secretStoreStatus().available) return;

  try {
    await execFileAsync(
      securityPath,
      ["delete-generic-password", "-a", id, "-s", service(namespace)],
      { encoding: "utf8" }
    );
  } catch {
    // Deleting metadata should stay idempotent when the keychain item is gone.
  }
}

function service(namespace: "connection" | "vault") {
  return `${servicePrefix}.${namespace}`;
}

function assertSecretStoreAvailable() {
  if (!secretStoreStatus().available) {
    throw new Error("No supported OS keychain is available on this host.");
  }
}

function optionalHostedEncryptionKey() {
  const encoded = getEnv().HOSTED_SECRET_ENCRYPTION_KEY;
  if (!encoded) return;

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "HOSTED_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
    );
  }
  return key;
}

function hostedEncryptionKey() {
  const key = optionalHostedEncryptionKey();
  if (!key) {
    throw new Error("HOSTED_SECRET_ENCRYPTION_KEY is required in hosted mode.");
  }
  return key;
}

function encryptSecret(
  scope: AccessScope,
  namespace: "connection" | "vault",
  id: string,
  value: string
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", hostedEncryptionKey(), iv);
  cipher.setAAD(secretAad(scope, namespace, id));
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

function decryptSecret(
  scope: AccessScope,
  namespace: "connection" | "vault",
  id: string,
  value: string
) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored secret uses an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    hostedEncryptionKey(),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAAD(secretAad(scope, namespace, id));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function secretAad(
  scope: AccessScope,
  namespace: "connection" | "vault",
  id: string
) {
  return Buffer.from(`${scope.workspaceId}\u0000${namespace}\u0000${id}`);
}

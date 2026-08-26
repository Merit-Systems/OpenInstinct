import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const securityPath = "/usr/bin/security";
const servicePrefix = "com.merit.local-vault-assistant";

export function secretStoreStatus() {
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
  value,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
  readonly value: string;
}) {
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
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
}) {
  assertSecretStoreAvailable();
  const { stdout } = await execFileAsync(
    securityPath,
    ["find-generic-password", "-a", id, "-s", service(namespace), "-w"],
    { encoding: "utf8" }
  );
  return stdout.trimEnd();
}

export function readSecretSync({
  id,
  namespace,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
}) {
  if (!secretStoreStatus().available) return;

  try {
    return execFileSync(
      securityPath,
      ["find-generic-password", "-a", id, "-s", service(namespace), "-w"],
      { encoding: "utf8" }
    ).trimEnd();
  } catch {
    return;
  }
}

export async function hasSecret({
  id,
  namespace,
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
}) {
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
}: {
  readonly id: string;
  readonly namespace: "connection" | "vault";
}) {
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

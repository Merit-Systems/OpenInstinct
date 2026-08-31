import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { get, put } from "@vercel/blob";
import { blobAuthentication } from "@/lib/blob-authentication";
import { env } from "@/lib/env";
import {
  installationSecretsSchema,
  type InstallationSecrets,
} from "@/lib/installation-secrets-schema";

const maximumInstallationSecretsBytes = 1024;
let installationSecretsPromise: Promise<InstallationSecrets> | undefined;

export function getInstallationSecrets() {
  installationSecretsPromise ??= resolveInstallationSecrets().catch(
    (error: unknown) => {
      installationSecretsPromise = undefined;
      throw error;
    }
  );
  return installationSecretsPromise;
}

async function resolveInstallationSecrets() {
  const configured = configuredInstallationSecrets();
  if (configured) return configured;

  const authentication = blobAuthentication(
    {
      readWriteToken: env.BLOB_READ_WRITE_TOKEN,
      storeId: env.BLOB_STORE_ID,
    },
    "Installation secrets are unavailable. Connect a private Vercel Blob store or set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY."
  );
  const pathname = installationSecretsPathname();
  const existing = await readInstallationSecrets(authentication, pathname);
  if (existing) return existing;

  const generated = installationSecretsSchema.parse({
    betterAuthSecret: randomBytes(32).toString("base64"),
    secretEncryptionKey: randomBytes(32).toString("base64"),
    version: 1,
  });
  try {
    await put(pathname, JSON.stringify(generated), {
      ...authentication,
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 365 * 24 * 60 * 60,
      contentType: "application/json",
      maximumSizeInBytes: maximumInstallationSecretsBytes,
    });
    return generated;
  } catch (error) {
    const winner = await readInstallationSecrets(authentication, pathname);
    if (winner) return winner;
    throw error;
  }
}

function configuredInstallationSecrets() {
  const betterAuthSecret = env.BETTER_AUTH_SECRET;
  const secretEncryptionKey = env.SECRET_ENCRYPTION_KEY;
  if (!betterAuthSecret && !secretEncryptionKey) return;
  if (!betterAuthSecret || !secretEncryptionKey) {
    throw new Error(
      "Set both BETTER_AUTH_SECRET and SECRET_ENCRYPTION_KEY, or leave both unset for automatic private Blob provisioning."
    );
  }
  return installationSecretsSchema.parse({
    betterAuthSecret,
    secretEncryptionKey,
    version: 1,
  });
}

async function readInstallationSecrets(
  authentication: { readonly storeId: string } | { readonly token: string },
  pathname: string
) {
  const result = await get(pathname, {
    ...authentication,
    access: "private",
    useCache: false,
  });
  if (!result) return;
  if (result.statusCode !== 200) {
    throw new Error("The installation secrets Blob returned no content.");
  }
  if (result.blob.size > maximumInstallationSecretsBytes) {
    throw new Error("The installation secrets Blob is unexpectedly large.");
  }
  const value: unknown = await new Response(result.stream).json();
  return installationSecretsSchema.parse(value);
}

function installationSecretsPathname() {
  const scope = createHash("sha256")
    .update(env.VERCEL_PROJECT_ID ?? "standalone")
    .digest("hex")
    .slice(0, 32);
  return `openinstinct/system/${scope}/installation-secrets.v1.json`;
}

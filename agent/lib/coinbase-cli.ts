import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@/lib/env";
import {
  coinbaseCliSha256,
  coinbaseCliSource,
  coinbaseCliVersion,
} from "./coinbase-cli-source.generated";

function materializeCoinbaseCli() {
  const directory = join(tmpdir(), "openinstinct-coinbase-runtime");
  const path = join(
    directory,
    `coinbase-cli-${coinbaseCliVersion}-${coinbaseCliSha256.slice(0, 16)}.mjs`
  );
  const expectedBytes = Buffer.byteLength(coinbaseCliSource);
  const valid = () => {
    try {
      const contents = readFileSync(path);
      return (
        contents.byteLength === expectedBytes &&
        createHash("sha256").update(contents).digest("hex") ===
          coinbaseCliSha256
      );
    } catch {
      return false;
    }
  };
  mkdirSync(directory, { mode: 0o700, recursive: true });
  if (valid()) return path;
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, coinbaseCliSource, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // A successful rename already removed the temporary file.
    }
  }
  if (!valid())
    throw new Error("The embedded Coinbase CLI could not be verified.");
  return path;
}

export const coinbaseCliPath = materializeCoinbaseCli();

export function coinbaseCredentialsConfigured() {
  return Boolean(env.COINBASE_KEY_ID && env.COINBASE_KEY_SECRET);
}

export function coinbaseCredentials() {
  if (!env.COINBASE_KEY_ID || !env.COINBASE_KEY_SECRET) {
    throw new Error(
      "Coinbase credentials are not configured. Set COINBASE_KEY_ID and COINBASE_KEY_SECRET."
    );
  }
  return { keyId: env.COINBASE_KEY_ID, keySecret: env.COINBASE_KEY_SECRET };
}

export function coinbaseChildEnvironment(): Record<string, string> {
  const credentials = coinbaseCredentials();
  const configDirectory = join(tmpdir(), "openinstinct-coinbase-config");
  mkdirSync(configDirectory, { mode: 0o700, recursive: true });
  return {
    CI: "1",
    COINBASE_CONFIG_DIR: configDirectory,
    COINBASE_ENV: "live",
    COINBASE_KEY_ID: credentials.keyId,
    COINBASE_KEY_SECRET: credentials.keySecret,
    COINBASE_NO_HISTORY: "1",
    COINBASE_NO_UPDATE_CHECK: "1",
    LANG: "C.UTF-8",
    NODE_ENV: env.NODE_ENV,
    TMPDIR: tmpdir(),
  };
}

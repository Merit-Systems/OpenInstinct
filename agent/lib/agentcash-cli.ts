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
  agentcashCliSha256,
  agentcashCliSource,
  agentcashCliVersion,
} from "./agentcash-cli-source.generated";

function materializeAgentcashCli() {
  const directory = join(tmpdir(), "openinstinct-agentcash-runtime");
  const path = join(
    directory,
    `agentcash-${agentcashCliVersion}-${agentcashCliSha256.slice(0, 16)}.mjs`
  );
  const expectedBytes = Buffer.byteLength(agentcashCliSource);
  const valid = () => {
    try {
      const contents = readFileSync(path);
      return (
        contents.byteLength === expectedBytes &&
        createHash("sha256").update(contents).digest("hex") ===
          agentcashCliSha256
      );
    } catch {
      return false;
    }
  };
  mkdirSync(directory, { mode: 0o700, recursive: true });
  if (valid()) return path;
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, agentcashCliSource, {
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
    throw new Error("The embedded Agentcash CLI could not be verified.");
  return path;
}

export const agentcashCliPath = materializeAgentcashCli();

export function agentcashChildEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      CI: "1",
      LANG: "C.UTF-8",
      NODE_ENV: env.NODE_ENV,
      TMPDIR: tmpdir(),
      X402_PRIVATE_KEY: env.X402_PRIVATE_KEY,
      X402_SOLANA_PRIVATE_KEY: env.X402_SOLANA_PRIVATE_KEY,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/* eslint-disable no-restricted-properties -- This CI-only fallback must read and forward GitHub's ephemeral OIDC environment. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import {
  auditUiSourceIntegrity,
  formatUiSourceIntegrityReport,
} from "@merit-systems/foundation";
import { z } from "zod";

const githubOidcResponseSchema = z.strictObject({
  value: z.string().min(1),
});

async function readGitHubOidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub Actions did not expose its OIDC request variables."
    );
  }

  const response = await fetch(requestUrl, {
    headers: { Authorization: `bearer ${requestToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub OIDC token request failed with status ${String(response.status)}.`
    );
  }

  const token = githubOidcResponseSchema.parse(await response.json()).value;
  console.log(`::add-mask::${token}`);
  return token;
}

async function runRegistryCommand(arguments_: string[], token: string) {
  const foundationEntry = import.meta.resolve("@merit-systems/foundation");
  const shadcnCli = createRequire(foundationEntry).resolve("shadcn");
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [shadcnCli, ...arguments_], {
      env: { ...process.env, MERIT_REGISTRY_OIDC_TOKEN: token },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`The shadcn registry command exited on ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) throw new Error("The shadcn registry command failed.");
  const completed = true;
  return { completed };
}

const token = await readGitHubOidcToken();
const report = await auditUiSourceIntegrity(process.cwd(), {
  runRegistryCommand: (arguments_) => runRegistryCommand(arguments_, token),
});

console.log(formatUiSourceIntegrityReport(report));
if (!report.compliant) process.exitCode = 1;

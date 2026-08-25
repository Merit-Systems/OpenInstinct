/* eslint-disable no-restricted-properties -- This CI-only check reads GitHub's ephemeral OIDC environment. */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

import {
  auditUiSourceIntegrity,
  formatUiSourceIntegrityReport,
} from "@merit-systems/foundation";
import { z } from "zod";

const githubOidcResponseSchema = z.strictObject({
  value: z.string().min(1),
});
const componentsConfigSchema = z.looseObject({
  registries: z.record(z.string(), z.unknown()).optional(),
});
const serverAddressSchema = z.object({
  port: z.number().int().positive(),
});

async function readRegistryToken() {
  const configuredToken = process.env.MERIT_REGISTRY_OIDC_TOKEN;
  if (configuredToken) return configuredToken;

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

  return githubOidcResponseSchema.parse(await response.json()).value;
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return serverAddressSchema.parse(server.address()).port;
}

async function close(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runShadcn(arguments_: string[]) {
  const foundationEntry = import.meta.resolve("@merit-systems/foundation");
  const shadcnCli = createRequire(foundationEntry).resolve("shadcn");
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [shadcnCli, ...arguments_], {
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
}

async function proxyRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string
) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!/^\/r\/[a-z0-9-]+\.json$/.test(requestUrl.pathname)) {
    response.writeHead(404).end();
    return;
  }
  const upstream = await fetch(
    `https://merit.engineering${requestUrl.pathname}`,
    { headers: { "x-vercel-trusted-oidc-idp-token": token } }
  );
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function runRegistryCommand(arguments_: string[], token: string) {
  const server = createServer((request, response) => {
    proxyRegistryRequest(request, response, token).catch(() => {
      if (!response.headersSent) response.writeHead(502);
      if (!response.writableEnded) response.end();
    });
  });

  const port = await listen(server);
  try {
    const cwdIndex = arguments_.indexOf("--cwd");
    const cwd = cwdIndex === -1 ? undefined : arguments_[cwdIndex + 1];
    if (!cwd) throw new Error("The registry command did not provide --cwd.");

    const configPath = path.join(cwd, "components.json");
    const config = componentsConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8"))
    );
    config.registries = {
      ...config.registries,
      "@merit": `http://127.0.0.1:${String(port)}/r/{name}.json`,
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runShadcn(arguments_);
  } finally {
    await close(server);
  }

  const completed = true;
  return { completed };
}

const token = await readRegistryToken();
const report = await auditUiSourceIntegrity(process.cwd(), {
  runRegistryCommand: (arguments_) => runRegistryCommand(arguments_, token),
});

console.log(formatUiSourceIntegrityReport(report));
if (!report.compliant) process.exitCode = 1;

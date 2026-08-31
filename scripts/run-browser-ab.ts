import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnvironment from "@next/env";
import { z } from "zod";
import { browserBenchmarkEnv } from "../evals/browser/env.ts";

const { loadEnvConfig } = nextEnvironment;

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
// oxlint-disable-next-line eslint/no-restricted-properties -- the benchmark supervisor must forward credentials and provider configuration to isolated child revisions
let inheritedEnvironment = { ...process.env };
const options = parseArguments(process.argv.slice(2));
const timestamp = new Date().toISOString().replaceAll(":", "-");
const outputDirectory = join(repositoryRoot, ".eve", "browser-ab", timestamp);
const temporaryRoot = await mkdtemp(join(tmpdir(), "eve-browser-ab-"));
const processes: ChildProcess[] = [];
const composeProjects: { cwd: string; name: string }[] = [];
let keepResources = options.keep;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    keepResources = false;
    void cleanup().finally(() => process.exit(130));
  });
}

try {
  inheritedEnvironment = await refreshGatewayEnvironment();
  await mkdir(outputDirectory, { recursive: true });
  const [baselineSha, candidateSha] = await Promise.all([
    resolveCommit(options.baselineRef),
    resolveCommit(options.candidateRef),
  ]);
  const variants = [
    variant("baseline", baselineSha),
    variant("candidate", candidateSha),
  ] as const;

  console.log(
    `Preparing browser A/B: ${shortSha(baselineSha)} → ${shortSha(candidateSha)}`
  );
  for (const current of variants) {
    await run(
      "git",
      ["worktree", "add", "--detach", current.path, current.sha],
      {
        cwd: repositoryRoot,
      }
    );
    await installBenchmarkChannel(current.path);
  }

  await Promise.all(
    variants.map((current) =>
      run("pnpm", ["install", "--frozen-lockfile"], { cwd: current.path })
    )
  );

  for (const current of variants) {
    current.databaseUrl = await startDatabase(current);
    await run("pnpm", ["db:migrate"], {
      cwd: current.path,
      env: databaseEnvironment(current.databaseUrl),
    });
  }

  for (const current of variants) {
    await startAgent(current);
  }

  const artifacts: Record<"baseline" | "candidate", string> = {
    baseline: "",
    candidate: "",
  };
  for (const current of variants) {
    artifacts[current.kind] = await runBenchmark(current);
  }

  const manifest = {
    baseline: { artifact: artifacts.baseline, gitSha: baselineSha },
    candidate: { artifact: artifacts.candidate, gitSha: candidateSha },
    completedAt: new Date().toISOString(),
    repetitions: options.repetitions,
    suite: options.suite,
    taskTimeoutMs: options.taskTimeoutMs,
    version: 1,
  };
  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  await run(
    "node",
    [
      "--experimental-strip-types",
      "scripts/compare-browser-benchmarks.ts",
      artifacts.baseline,
      artifacts.candidate,
    ],
    { cwd: repositoryRoot }
  );

  console.log(`A/B artifacts: ${outputDirectory}`);
  if (options.keep) {
    console.log(`Baseline: ${variants[0].url}`);
    console.log(`Candidate: ${variants[1].url}`);
  }
} finally {
  await cleanup();
}

function variant(kind: "baseline" | "candidate", sha: string) {
  const suffix = `${shortSha(sha)}-${String(process.pid)}`;
  const name = `eve-browser-${kind}-${suffix}`;
  return {
    databaseUrl: "",
    kind,
    name,
    path: join(temporaryRoot, kind),
    sha,
    url: `https://${name}.localhost`,
  };
}

async function installBenchmarkChannel(worktree: string) {
  const sourcePath = join(repositoryRoot, "agent", "channels", "eve.ts");
  const targetPath = join(worktree, "agent", "channels", "eve.ts");
  await copyFile(sourcePath, targetPath);
  await copyFile(
    join(repositoryRoot, ".env.local"),
    join(worktree, ".env.local")
  );

  const principal = browserBenchmarkEnv.BROWSER_BENCH_SCOPE_PRINCIPAL?.trim();
  if (!principal) return;
  const source = await readFile(targetPath, "utf8");
  const marker = '"better-auth:browser-benchmark"';
  if (!source.includes(marker)) {
    throw new Error(
      "The benchmark channel has no replaceable local principal."
    );
  }
  await writeFile(
    targetPath,
    source.replace(marker, JSON.stringify(principal))
  );
}

async function refreshGatewayEnvironment() {
  const commonGitDirectory = (
    await output(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: repositoryRoot }
    )
  ).trim();
  const projectFile = join(
    dirname(commonGitDirectory),
    ".vercel",
    "project.json"
  );
  const project = z
    .object({ orgId: z.string().min(1), projectId: z.string().min(1) })
    .parse(JSON.parse(await readFile(projectFile, "utf8")));

  await run(
    "node_modules/eve/bin/eve.js",
    [
      "link",
      "--non-interactive",
      "--project",
      project.projectId,
      "--team",
      project.orgId,
    ],
    { cwd: repositoryRoot }
  );

  return {
    ...loadEnvConfig(repositoryRoot, true, console, true).combinedEnv,
    NODE_ENV: "development" as const,
  };
}

async function startDatabase(current: ReturnType<typeof variant>) {
  const name = `browser-ab-${current.kind}-${hash(current.path).slice(0, 10)}`;
  composeProjects.push({ cwd: current.path, name });
  await run(
    "docker",
    ["compose", "--project-name", name, "up", "--detach", "--wait", "postgres"],
    { cwd: current.path }
  );
  const address = await output(
    "docker",
    ["compose", "--project-name", name, "port", "postgres", "5432"],
    { cwd: current.path }
  );
  const port = /:(\d+)\s*$/u.exec(address)?.[1];
  if (!port)
    throw new Error(`Could not resolve PostgreSQL port for ${current.kind}.`);
  return `postgresql://postgres:postgres@127.0.0.1:${port}/open_instinct`;
}

async function startAgent(current: ReturnType<typeof variant>) {
  const child = start(
    "portless",
    ["--name", current.name, "node_modules/eve/bin/eve.js", "dev", "--no-ui"],
    {
      cwd: current.path,
      env: {
        ...databaseEnvironment(current.databaseUrl),
        BETTER_AUTH_URL: current.url,
        EVE_DEV: "1",
        NODE_ENV: "development",
      },
    }
  );
  processes.push(child);
  await waitForUrl(`${current.url}/eve/v1/health`, child);
}

async function runBenchmark(current: ReturnType<typeof variant>) {
  const label = `${current.kind}-${shortSha(current.sha)}-${options.suite}`;
  await run(
    "node_modules/eve/bin/eve.js",
    [
      "eval",
      "browser",
      "--url",
      current.url,
      "--strict",
      "--timeout",
      String(options.taskTimeoutMs),
      "--max-concurrency",
      String(options.maxConcurrency),
    ],
    {
      cwd: repositoryRoot,
      env: {
        BROWSER_BENCH_LABEL: label,
        BROWSER_BENCH_REPETITIONS: String(options.repetitions),
        BROWSER_BENCH_SUITE: options.suite,
        NODE_EXTRA_CA_CERTS:
          inheritedEnvironment.NODE_EXTRA_CA_CERTS ??
          join(homedir(), ".portless", "ca.pem"),
        NODE_ENV: "development",
      },
      validExitCodes: [0, 1],
    }
  );

  const latest = join(
    repositoryRoot,
    ".eve",
    "browser-benchmarks",
    "latest.json"
  );
  const artifact = join(outputDirectory, `${current.kind}.json`);
  await copyFile(latest, artifact);
  return artifact;
}

async function waitForUrl(url: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `${basename(child.spawnfile)} exited before ${url} was ready.`
      );
    }
    try {
      await run("curl", ["--fail", "--silent", "--show-error", url], {
        cwd: repositoryRoot,
      });
      return;
    } catch {
      await delay(1_000);
    }
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function databaseEnvironment(databaseUrl: string) {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    NODE_ENV: "development" as const,
  };
}

function start(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: { ...inheritedEnvironment, ...options.env },
    stdio: "inherit",
  });
  child.unref();
  return child;
}

async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    validExitCodes?: number[];
  }
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...inheritedEnvironment, ...options.env },
    stdio: "inherit",
  });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (!(options.validExitCodes ?? [0]).includes(code ?? -1)) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${String(code)}.`
    );
  }
}

async function output(
  command: string,
  args: string[],
  options: { cwd: string }
) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: inheritedEnvironment,
    stdio: ["ignore", "pipe", "inherit"],
  });
  child.stdout.setEncoding("utf8");
  let value = "";
  child.stdout.on("data", (chunk: string) => {
    value += chunk;
  });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) throw new Error(`${command} exited with ${String(code)}.`);
  return value;
}

async function resolveCommit(reference: string) {
  return (
    await output("git", ["rev-parse", "--verify", `${reference}^{commit}`], {
      cwd: repositoryRoot,
    })
  ).trim();
}

async function cleanup() {
  if (keepResources) return;
  for (const child of processes.toReversed()) {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (errorCode(error) !== "ESRCH") throw error;
      }
    }
  }
  for (const project of composeProjects.toReversed()) {
    await run(
      "docker",
      ["compose", "--project-name", project.name, "down", "--volumes"],
      { cwd: project.cwd }
    ).catch(() => undefined);
  }
  for (const name of ["candidate", "baseline"]) {
    const path = join(temporaryRoot, name);
    await run("git", ["worktree", "remove", "--force", path], {
      cwd: repositoryRoot,
    }).catch(() => undefined);
  }
  await rm(temporaryRoot, { force: true, recursive: true });
}

function parseArguments(args: string[]) {
  const positional: string[] = [];
  let suite: "all" | "live" | "profile" | "smoke" = "smoke";
  let repetitions = 1;
  let maxConcurrency = 1;
  let taskTimeoutMs = 15 * 60_000;
  let keep = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--keep") {
      keep = true;
      continue;
    }
    if (argument === "--suite") {
      const value = args[++index];
      if (
        value !== "all" &&
        value !== "live" &&
        value !== "profile" &&
        value !== "smoke"
      ) {
        throw new Error("--suite must be smoke, live, profile, or all.");
      }
      suite = value;
      continue;
    }
    if (argument === "--repetitions" || argument === "--max-concurrency") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new Error(`${argument} must be an integer from 1 to 20.`);
      }
      if (argument === "--repetitions") repetitions = value;
      else maxConcurrency = value;
      continue;
    }
    if (argument === "--task-timeout-minutes") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 60) {
        throw new Error(
          "--task-timeout-minutes must be an integer from 1 to 60."
        );
      }
      taskTimeoutMs = value * 60_000;
      continue;
    }
    if (argument?.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (argument) positional.push(argument);
  }

  const [baselineRef, candidateRef] = positional;
  if (positional.length !== 2 || !baselineRef || !candidateRef) {
    throw new Error(
      "Usage: pnpm bench:ab <baseline-ref> <candidate-ref> [--suite smoke|live|profile|all] [--repetitions n] [--max-concurrency n] [--task-timeout-minutes n] [--keep]"
    );
  }
  return {
    baselineRef,
    candidateRef,
    keep,
    maxConcurrency,
    repetitions,
    suite,
    taskTimeoutMs,
  };
}

function shortSha(sha: string) {
  return sha.slice(0, 12);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

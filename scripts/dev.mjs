import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const composeProject = `open-instinct-${createHash("sha256")
  .update(repositoryRoot)
  .digest("hex")
  .slice(0, 12)}`;
const composeArguments = (...args) => [
  "compose",
  "--project-name",
  composeProject,
  ...args,
];

// oxlint-disable-next-line eslint/no-restricted-properties -- the development supervisor must forward the caller's environment to its child processes
const inheritedEnvironment = { ...process.env };

function developmentEnvironment(port) {
  const localDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/open_instinct`;
  return {
    ...inheritedEnvironment,
    DATABASE_URL: localDatabaseUrl,
    DATABASE_URL_UNPOOLED: localDatabaseUrl,
  };
}

async function resolvePostgresPort() {
  const output = await runForOutput(
    "docker",
    composeArguments("port", "postgres", "5432")
  );
  if (output === undefined) return;
  const port = output.trim().match(/:(\d+)$/)?.[1];
  if (!port) {
    throw new Error("Could not resolve the local PostgreSQL port.");
  }
  return port;
}

let activeChild;
let composeAttempted = false;
let shutdownSignal;

function interrupt(child, signal) {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }

    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error(`Failed to forward ${signal} to ${child.pid}:`, error);
      process.exitCode = 1;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shutdownSignal === undefined) {
      shutdownSignal = signal;
      if (activeChild !== undefined) {
        interrupt(activeChild, signal);
      }
    }
  });
}

async function run(
  command,
  args,
  { allowInterruption = false, env = inheritedEnvironment } = {}
) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env,
    stdio: "inherit",
  });
  activeChild = child;

  try {
    const [code] = await once(child, "exit");

    if (code !== 0 && !(allowInterruption && shutdownSignal !== undefined)) {
      throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
    }

    return code === 0 && shutdownSignal === undefined;
  } finally {
    if (activeChild === child) {
      activeChild = undefined;
    }
  }
}

async function runForOutput(command, args) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: inheritedEnvironment,
    stdio: ["inherit", "pipe", "inherit"],
  });
  activeChild = child;
  child.stdout.setEncoding("utf8");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });

  try {
    const [code] = await once(child, "exit");
    if (code !== 0 && shutdownSignal === undefined) {
      throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
    }
    return shutdownSignal === undefined ? output : undefined;
  } finally {
    if (activeChild === child) {
      activeChild = undefined;
    }
  }
}

try {
  composeAttempted = true;
  let shouldContinue = await run(
    "docker",
    composeArguments("up", "--detach", "--wait"),
    { allowInterruption: true }
  );

  if (shouldContinue) {
    const port = await resolvePostgresPort();
    shouldContinue = port !== undefined;

    if (shouldContinue) {
      const environment = developmentEnvironment(port);
      shouldContinue = await run("pnpm", ["db:migrate"], {
        allowInterruption: true,
        env: environment,
      });

      if (shouldContinue) {
        await run("pnpm", ["dev:app"], {
          allowInterruption: true,
          env: environment,
        });
      }
    }
  }
} finally {
  if (composeAttempted) {
    await run("docker", composeArguments("down"));
  }
}

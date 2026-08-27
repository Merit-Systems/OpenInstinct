import { spawn } from "node:child_process";
import { once } from "node:events";

const localDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:54329/open_instinct";

const developmentEnvironment = {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the development supervisor must forward the caller's environment to its child processes
  ...process.env,
  DATABASE_URL: localDatabaseUrl,
  DATABASE_URL_UNPOOLED: localDatabaseUrl,
};

let activeChild;
let composeAttempted = false;
let shutdownSignal;

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shutdownSignal === undefined) {
      shutdownSignal = signal;
      activeChild?.kill(signal);
    }
  });
}

async function run(command, args, { allowInterruption = false } = {}) {
  const child = spawn(command, args, {
    env: developmentEnvironment,
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

try {
  composeAttempted = true;
  let shouldContinue = await run(
    "docker",
    ["compose", "up", "--detach", "--wait"],
    { allowInterruption: true }
  );

  if (shouldContinue) {
    shouldContinue = await run("pnpm", ["db:migrate"], {
      allowInterruption: true,
    });
  }

  if (shouldContinue) {
    await run("pnpm", ["exec", "turbo", "run", "dev:app"], {
      allowInterruption: true,
    });
  }
} finally {
  if (composeAttempted) {
    await run("docker", ["compose", "down"]);
  }
}

if (shutdownSignal !== undefined) {
  const signalExitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
  process.exitCode = signalExitCodes[shutdownSignal];
}

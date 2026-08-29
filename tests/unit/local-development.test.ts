import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

describe("local development", () => {
  it("owns the PostgreSQL lifecycle around the application process", async () => {
    const [compose, developmentScript, packageManifestSource] =
      await Promise.all([
        readFile(new URL("../../compose.yaml", import.meta.url), "utf8"),
        readFile(new URL("../../scripts/dev.mjs", import.meta.url), "utf8"),
        readFile(new URL("../../package.json", import.meta.url), "utf8"),
      ]);
    const packageManifest = z
      .object({ scripts: z.object({ dev: z.string() }) })
      .parse(JSON.parse(packageManifestSource));

    expect(packageManifest.scripts.dev).toBe("node scripts/dev.mjs");
    expect(compose).toContain("image: postgres:17-alpine");
    expect(compose).toContain('"127.0.0.1::5432"');
    expect(compose).toContain("postgres-data:/var/lib/postgresql/data");
    expect(compose).toContain("pg_isready -U postgres -d open_instinct");

    const start = developmentScript.indexOf(
      'composeArguments("up", "--detach", "--wait")'
    );
    const port = developmentScript.indexOf(
      'composeArguments("port", "postgres", "5432")'
    );
    const migrate = developmentScript.indexOf('["db:migrate"]');
    const application = developmentScript.indexOf('["dev:app"]');
    const stop = developmentScript.indexOf('composeArguments("down")');

    expect(start).toBeGreaterThan(-1);
    expect(port).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(start);
    expect(application).toBeGreaterThan(migrate);
    expect(stop).toBeGreaterThan(application);
    expect(developmentScript).toContain('createHash("sha256")');
    expect(developmentScript).toContain("DATABASE_URL: localDatabaseUrl");
    expect(developmentScript).toContain(
      "DATABASE_URL_UNPOOLED: localDatabaseUrl"
    );
  });

  it("tears Compose down when interrupted during startup", async () => {
    const result = await interruptDuringStartup();

    expect(result.code).toBe(0);
    expectIsolatedLifecycle(result.commands);
  });

  it("does not advance when interrupted startup exits cleanly", async () => {
    const result = await interruptDuringStartup({ DEV_STARTUP_EXIT: "0" });

    expect(result.code).toBe(0);
    expectIsolatedLifecycle(result.commands);
  });

  it("tears Compose down when interrupted during port discovery", async () => {
    const result = await interruptDuringStartup({ DEV_BLOCK_ACTION: "port" });

    expect(result.code).toBe(0);
    const lines = result.commands.trim().split("\n");
    const project = projectFromComposeCommand(lines[0]);
    expect(lines).toEqual([
      `compose --project-name ${project} up --detach --wait`,
      `compose --project-name ${project} port postgres 5432`,
      `compose --project-name ${project} down`,
    ]);
  });

  it("reports teardown failure after an interruption", async () => {
    const result = await interruptDuringStartup({ DEV_DOWN_EXIT: "1" });

    expect(result.code).toBe(1);
    expectIsolatedLifecycle(result.commands);
  });

  it("passes the assigned PostgreSQL port to migrations and the app", async () => {
    const result = await runSuccessfulSupervisor();

    expect(result.code).toBe(0);
    const lines = result.commands.trim().split("\n");
    const project = projectFromComposeCommand(lines[0]);
    expect(lines).toEqual([
      `compose --project-name ${project} up --detach --wait`,
      `compose --project-name ${project} port postgres 5432`,
      "pnpm db:migrate postgresql://postgres:postgres@127.0.0.1:49152/open_instinct",
      "pnpm dev:app postgresql://postgres:postgres@127.0.0.1:49152/open_instinct",
      `compose --project-name ${project} down`,
    ]);
  });
});

function expectIsolatedLifecycle(commands: string) {
  const lines = commands.trim().split("\n");
  const project = projectFromComposeCommand(lines[0]);
  expect(lines).toEqual([
    `compose --project-name ${project} up --detach --wait`,
    `compose --project-name ${project} down`,
  ]);
}

function projectFromComposeCommand(command: string | undefined) {
  const project = command?.match(
    /^compose --project-name (open-instinct-[a-f0-9]{12}) /
  )?.[1];
  if (!project) {
    throw new Error(`Missing Compose project in: ${String(command)}`);
  }
  return project;
}

async function interruptDuringStartup(
  environment: Record<string, string> = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "open-instinct-dev-"));
  temporaryDirectories.push(directory);
  const logPath = join(directory, "commands.log");
  const dockerPath = join(directory, "docker");
  const pnpmPath = join(directory, "pnpm");
  await Promise.all([
    writeFile(
      dockerPath,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$DEV_SUPERVISOR_LOG"
if [ "$4" = "\${DEV_BLOCK_ACTION:-up}" ]; then
  trap 'exit "\${DEV_STARTUP_EXIT:-130}"' INT TERM HUP
  while true; do /bin/sleep 0.1; done
fi
if [ "$4" = "port" ]; then
  printf '127.0.0.1:49152\n'
fi
if [ "$4" = "down" ]; then
  exit "\${DEV_DOWN_EXIT:-0}"
fi
`
    ),
    writeFile(
      pnpmPath,
      `#!/bin/sh
printf 'pnpm %s\\n' "$*" >> "$DEV_SUPERVISOR_LOG"
`
    ),
  ]);
  await Promise.all([chmod(dockerPath, 0o755), chmod(pnpmPath, 0o755)]);

  const supervisor = spawn(
    process.execPath,
    [new URL("../../scripts/dev.mjs", import.meta.url).pathname],
    {
      env: {
        DEV_SUPERVISOR_LOG: logPath,
        NODE_ENV: "test",
        PATH: directory,
        ...environment,
      },
      stdio: "ignore",
    }
  );

  await waitForLogEntry(
    logPath,
    environment.DEV_BLOCK_ACTION === "port"
      ? " port postgres 5432"
      : " up --detach --wait"
  );
  const exitCode = new Promise<number | null>((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.once("exit", resolve);
  });
  supervisor.kill("SIGINT");

  return {
    code: await exitCode,
    commands: await readFile(logPath, "utf8"),
  };
}

async function runSuccessfulSupervisor() {
  const directory = await mkdtemp(join(tmpdir(), "open-instinct-dev-"));
  temporaryDirectories.push(directory);
  const logPath = join(directory, "commands.log");
  const dockerPath = join(directory, "docker");
  const pnpmPath = join(directory, "pnpm");
  await Promise.all([
    writeFile(
      dockerPath,
      `#!/bin/sh
printf '%s\n' "$*" >> "$DEV_SUPERVISOR_LOG"
if [ "$4" = "port" ]; then
  printf '127.0.0.1:49152\n'
fi
`
    ),
    writeFile(
      pnpmPath,
      `#!/bin/sh
printf 'pnpm %s %s\n' "$*" "$DATABASE_URL" >> "$DEV_SUPERVISOR_LOG"
`
    ),
  ]);
  await Promise.all([chmod(dockerPath, 0o755), chmod(pnpmPath, 0o755)]);

  const supervisor = spawn(
    process.execPath,
    [new URL("../../scripts/dev.mjs", import.meta.url).pathname],
    {
      env: {
        DEV_SUPERVISOR_LOG: logPath,
        NODE_ENV: "test",
        PATH: directory,
      },
      stdio: "ignore",
    }
  );
  const exitCode = new Promise<number | null>((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.once("exit", resolve);
  });

  return {
    code: await exitCode,
    commands: await readFile(logPath, "utf8"),
  };
}

async function waitForLogEntry(path: string, expected: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const contents = await readFile(path, "utf8").catch(() => "");
    if (contents.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${expected}`);
}

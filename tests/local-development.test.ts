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
        readFile(new URL("../compose.yaml", import.meta.url), "utf8"),
        readFile(new URL("../scripts/dev.mjs", import.meta.url), "utf8"),
        readFile(new URL("../package.json", import.meta.url), "utf8"),
      ]);
    const packageManifest = z
      .object({ scripts: z.object({ dev: z.string() }) })
      .parse(JSON.parse(packageManifestSource));

    expect(packageManifest.scripts.dev).toBe("node scripts/dev.mjs");
    expect(compose).toContain("image: postgres:17-alpine");
    expect(compose).toContain('"127.0.0.1:54329:5432"');
    expect(compose).toContain("postgres-data:/var/lib/postgresql/data");
    expect(compose).toContain("pg_isready -U postgres -d open_instinct");

    const start = developmentScript.indexOf("composeAttempted = true");
    const migrate = developmentScript.indexOf('["db:migrate"]');
    const application = developmentScript.indexOf(
      '["exec", "turbo", "run", "dev:app"]'
    );
    const stop = developmentScript.indexOf('["compose", "down"]');

    expect(start).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(start);
    expect(application).toBeGreaterThan(migrate);
    expect(stop).toBeGreaterThan(application);
    expect(developmentScript).toContain("DATABASE_URL: localDatabaseUrl");
    expect(developmentScript).toContain(
      "DATABASE_URL_UNPOOLED: localDatabaseUrl"
    );
  });

  it("tears Compose down when interrupted during startup", async () => {
    const result = await interruptDuringStartup();

    expect(result.code).toBe(130);
    expect(result.commands).toBe("compose up --detach --wait\ncompose down\n");
  });

  it("does not advance when interrupted startup exits cleanly", async () => {
    const result = await interruptDuringStartup({ DEV_STARTUP_EXIT: "0" });

    expect(result.code).toBe(130);
    expect(result.commands).toBe("compose up --detach --wait\ncompose down\n");
  });

  it("reports teardown failure after an interruption", async () => {
    const result = await interruptDuringStartup({ DEV_DOWN_EXIT: "1" });

    expect(result.code).toBe(1);
    expect(result.commands).toBe("compose up --detach --wait\ncompose down\n");
  });
});

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
if [ "$2" = "up" ]; then
  trap 'exit "\${DEV_STARTUP_EXIT:-130}"' INT TERM HUP
  while true; do /bin/sleep 0.1; done
fi
if [ "$2" = "down" ]; then
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
    [new URL("../scripts/dev.mjs", import.meta.url).pathname],
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

  await waitForLogEntry(logPath, "compose up --detach --wait");
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

async function waitForLogEntry(path: string, expected: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const contents = await readFile(path, "utf8").catch(() => "");
    if (contents.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${expected}`);
}

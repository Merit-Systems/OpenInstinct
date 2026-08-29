import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export async function createRealPostgres() {
  // REAL_PG: unset auto-detects, 0 force-skips, and 1 requires Compose Postgres.
  // oxlint-disable-next-line eslint/no-restricted-properties -- this optional harness switch avoids requiring Docker for the default suite.
  const mode = process.env.REAL_PG;
  if (mode === "0") return;

  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const derivedProjectName = `open-instinct-${createHash("sha256")
    .update(repositoryRoot)
    .digest("hex")
    .slice(0, 12)}`;
  // oxlint-disable-next-line eslint/no-restricted-properties -- test-only override proves REAL_PG=1 fails against an unavailable project.
  const projectName = process.env.REAL_PG_COMPOSE_PROJECT ?? derivedProjectName;
  const portOutput = await dockerOutput([
    "compose",
    "--project-name",
    projectName,
    "port",
    "postgres",
    "5432",
  ]);
  const port = portOutput?.trim().match(/:(\d+)$/)?.[1];
  if (!port) {
    if (mode === "1") {
      throw new Error(
        "REAL_PG=1 requires a reachable Compose Postgres service."
      );
    }
    return;
  }

  const databaseName = `test_${randomUUID().replaceAll("-", "")}`;
  const adminConnectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/open_instinct`;
  const admin = new Pool({ connectionString: adminConnectionString });

  try {
    await admin.query("SELECT 1");
  } catch (error) {
    await admin.end();
    if (mode === "1") {
      throw new Error("REAL_PG=1 could not connect to Compose Postgres.", {
        cause: error,
      });
    }
    return;
  }

  try {
    // Databases prefixed test_ are this harness's manual stale-database cleanup handle.
    await dropStaleDatabases(admin);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/${databaseName}`;
    await applyMigrations(connectionString);
    return {
      connectionString,
      async close() {
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName]
        );
        await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        await admin.end();
      },
    };
  } catch (error) {
    await dropDatabase(admin, databaseName);
    await admin.end();
    throw error;
  }
}

async function dropStaleDatabases(admin: Pool) {
  const { rows } = await admin.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname LIKE 'test\\_%' ESCAPE '\\'"
  );
  await Promise.all(rows.map(({ datname }) => dropDatabase(admin, datname)));
}

async function dropDatabase(admin: Pool, databaseName: string) {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
}

async function applyMigrations(connectionString: string) {
  const database = new Pool({ connectionString });
  try {
    const migrationDirectory = new URL("../../db/migrations/", import.meta.url);
    const names = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names) {
      const migration = await readFile(
        new URL(name, migrationDirectory),
        "utf8"
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await database.query(statement);
      }
    }
  } finally {
    await database.end();
  }
}

async function dockerOutput(arguments_: string[]) {
  return await new Promise<string | undefined>((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn("docker", arguments_, {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      stdio: ["ignore", "pipe", "ignore"],
    });
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(undefined);
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", () => {
      finish(undefined);
    });
    child.on("exit", (code) => {
      finish(code === 0 ? output : undefined);
    });
  });
}

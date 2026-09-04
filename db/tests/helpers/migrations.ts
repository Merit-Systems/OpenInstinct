/* oxlint-disable eslint/no-await-in-loop -- Migrations and their statements must be applied in order. */
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";

const migrationFiles = [
  "0000_fluffy_the_spike.sql",
  "0001_better-auth.sql",
  "0002_heavy_celestials.sql",
  "0003_unusual_fabian_cortez.sql",
  "0004_kind_manta.sql",
  "0005_brave_kang.sql",
  "0006_illegal_tattoo.sql",
  "0007_known_fenris.sql",
  "0008_black_sandman.sql",
  "0009_cold_power_man.sql",
  "0010_rapid_cerise.sql",
  "0011_faulty_unicorn.sql",
  "0012_tricky_prima.sql",
] as const;

export async function applyMigration(database: PGlite, filename: string) {
  const source = await readFile(
    new URL(`../../migrations/${filename}`, import.meta.url),
    "utf8"
  );
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

export async function applyAllMigrations(database: PGlite) {
  for (const filename of migrationFiles) {
    await applyMigration(database, filename);
  }
}

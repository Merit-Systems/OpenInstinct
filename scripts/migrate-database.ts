import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { getEnv } from "../lib/runtime-env.ts";

const databaseUrl = getEnv().DATABASE_URL;

if (!databaseUrl) {
  console.info("DATABASE_URL is not configured; skipping Drizzle migrations.");
} else {
  const protocol = new URL(databaseUrl).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a Postgres connection URL.");
  }

  await migrate(drizzle(neon(databaseUrl)), {
    migrationsFolder: "drizzle",
  });
  console.info("Drizzle migrations are current.");
}

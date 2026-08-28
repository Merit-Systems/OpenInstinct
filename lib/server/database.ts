import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { getEnv } from "../runtime-env";

const FALLBACK_DATABASE_URL =
  "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured";

const databaseUrl = getEnv().DATABASE_URL;
const client = neon(databaseUrl ?? FALLBACK_DATABASE_URL);

export const db = drizzle({ client, schema });

export function database() {
  if (!databaseUrl) throw new Error("A Postgres DATABASE_URL is required.");
  return db;
}

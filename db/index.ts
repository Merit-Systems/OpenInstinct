import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export * from "./schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });

const defaultDb = drizzle({ client: pool, schema });

export const db = defaultDb;

interface IntegrationDatabase {
  readonly _: unknown;
}

/**
 * Replaces the database boundary for an in-process integration harness.
 * Production code keeps the pool-backed default established above.
 */
export function setDatabaseForIntegrationTest(database: IntegrationDatabase) {
  Object.assign(db, database);
}

export function resetDatabaseForIntegrationTest() {
  Object.assign(db, defaultDb);
}

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "../lib/env";
import * as schema from "./schema";

export * from "./schema";

export const db = drizzle(neon(env.DATABASE_URL), { schema });
export type Database = typeof db;

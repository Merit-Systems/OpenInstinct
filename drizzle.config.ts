import { defineConfig } from "drizzle-kit";
import { getEnv } from "./lib/runtime-env";

const databaseUrl = getEnv().DATABASE_URL;

export default defineConfig({
  dbCredentials: {
    url:
      databaseUrl ??
      "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured",
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
  strict: true,
});

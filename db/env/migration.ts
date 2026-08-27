import { loadEnvConfig } from "@next/env";
import { createEnv } from "@t3-oss/env-nextjs";
import { databaseUrlSchema } from "./utils";

loadEnvConfig(process.cwd());

export const dbMigrationEnv = createEnv({
  server: {
    DATABASE_URL_UNPOOLED: databaseUrlSchema,
  },
  experimental__runtimeEnv: {},
});

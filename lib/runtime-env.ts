import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalValue = z
  .string()
  .transform((value) => (value.trim().length === 0 ? undefined : value))
  .optional();

export function getEnv() {
  return createEnv({
    server: {
      BETTER_AUTH_API_KEY: optionalValue,
      BETTER_AUTH_INFRA_API_KEY: optionalValue,
      BETTER_AUTH_SECRET: optionalValue,
      BETTER_AUTH_URL: optionalValue.refine(
        (value) => value === undefined || URL.canParse(value),
        "BETTER_AUTH_URL must be an absolute URL"
      ),
      BROWSER_BENCH_LABEL: z.string().min(1).optional(),
      BROWSER_BENCH_REPETITIONS: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(1),
      DATABASE_URL: optionalValue.refine(
        (value) =>
          value === undefined ||
          value.startsWith("file:") ||
          value.startsWith("postgres://") ||
          value.startsWith("postgresql://"),
        "DATABASE_URL must be a file:, postgres://, or postgresql:// URL"
      ),
      EVE_NEXT_PRODUCTION_ORIGIN: optionalValue.refine(
        (value) => value === undefined || URL.canParse(value),
        "EVE_NEXT_PRODUCTION_ORIGIN must be an absolute URL"
      ),
      HOSTED_SECRET_ENCRYPTION_KEY: optionalValue,
      KERNEL_API_KEY: optionalValue,
      LOCAL_VAULT_ASSISTANT_ALLOW_REMOTE_MANAGER: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
      LOCAL_VAULT_ASSISTANT_BROWSER_EXECUTABLE: optionalValue,
      LOCAL_VAULT_ASSISTANT_DATA_DIR: optionalValue,
      LOCAL_VAULT_ASSISTANT_MANAGER_URL: optionalValue.refine(
        (value) => value === undefined || URL.canParse(value),
        "LOCAL_VAULT_ASSISTANT_MANAGER_URL must be an absolute URL"
      ),
      LOCAL_VAULT_ASSISTANT_MODEL: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODEL_API_KEY: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODE: z.enum(["hosted", "local"]).optional(),
      VERCEL: optionalValue,
      VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
      VERCEL_REGION: optionalValue,
    },
    experimental__runtimeEnv: {},
  });
}

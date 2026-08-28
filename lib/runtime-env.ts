import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalValue = z
  .string()
  .transform((value) => (value.trim().length === 0 ? undefined : value))
  .optional();

export function getEnv() {
  return createEnv({
    server: {
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
          value.startsWith("postgres://") ||
          value.startsWith("postgresql://"),
        "DATABASE_URL must be a postgres:// or postgresql:// URL"
      ),
      EVE_NEXT_PRODUCTION_ORIGIN: optionalValue.refine(
        (value) => value === undefined || URL.canParse(value),
        "EVE_NEXT_PRODUCTION_ORIGIN must be an absolute URL"
      ),
      HOSTED_SECRET_ENCRYPTION_KEY: optionalValue,
      SECRET_ENCRYPTION_KEY: optionalValue,
      KERNEL_API_KEY: optionalValue,
      KERNEL_VAULT_AUTOFILL_EXTENSION: optionalValue,
      NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("production"),
      VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    },
    experimental__runtimeEnv: {},
  });
}

export function isLocalPhoneAuthBypassEnabled(
  env: Pick<
    ReturnType<typeof getEnv>,
    "BETTER_AUTH_URL" | "NODE_ENV" | "VERCEL_ENV"
  > = getEnv()
) {
  if (
    env.NODE_ENV !== "development" ||
    env.VERCEL_ENV !== undefined ||
    !env.BETTER_AUTH_URL
  ) {
    return false;
  }

  const hostname = new URL(env.BETTER_AUTH_URL).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { databaseUrlSchema } from "../db/env/utils";

const optionalValue = z
  .string()
  .transform((value) => (value.trim().length === 0 ? undefined : value))
  .optional();

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const runtimeEnv = createEnv({
  server: {
    BETTER_AUTH_SECRET: requiredValue,
    BETTER_AUTH_URL: requiredValue.refine(
      (value) => URL.canParse(value),
      "BETTER_AUTH_URL must be an absolute URL"
    ),
    BROWSER_BENCH_LABEL: z.string().min(1).optional(),
    BROWSER_BENCH_REPETITIONS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(1),
    DATABASE_URL: databaseUrlSchema,
    EVE_NEXT_PRODUCTION_ORIGIN: optionalValue.refine(
      (value) => value === undefined || URL.canParse(value),
      "EVE_NEXT_PRODUCTION_ORIGIN must be an absolute URL"
    ),
    HOSTED_SECRET_ENCRYPTION_KEY: optionalValue,
    SECRET_ENCRYPTION_KEY: optionalValue,
    KERNEL_API_KEY: requiredValue,
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  },
  experimental__runtimeEnv: {},
});

const secretEncryptionKey =
  runtimeEnv.SECRET_ENCRYPTION_KEY ?? runtimeEnv.HOSTED_SECRET_ENCRYPTION_KEY;

if (!secretEncryptionKey) {
  throw new Error("SECRET_ENCRYPTION_KEY is required.");
}

if (Buffer.from(secretEncryptionKey, "base64").length !== 32) {
  throw new Error(
    "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
  );
}

export const env = {
  ...runtimeEnv,
  SECRET_ENCRYPTION_KEY: secretEncryptionKey,
};

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { databaseUrlSchema } from "../db/env/utils";

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const secretEncryptionKeySchema = requiredValue.refine(
  (value) => Buffer.from(value, "base64").length === 32,
  "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
);

const optionalValue = z.string().optional();

export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: requiredValue,
    BETTER_AUTH_URL: requiredValue.refine(
      (value) => URL.canParse(value),
      "BETTER_AUTH_URL must be an absolute URL"
    ),
    DATABASE_URL: databaseUrlSchema,
    KERNEL_API_KEY: requiredValue,
    SECRET_ENCRYPTION_KEY: secretEncryptionKeySchema,

    GOOGLE_CONNECTOR_UID: optionalValue,
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

const authHostname = new URL(env.BETTER_AUTH_URL).hostname;

export const localPhoneAuthBypassEnabled =
  env.NODE_ENV === "development" &&
  env.VERCEL_ENV === undefined &&
  (authHostname === "localhost" ||
    authHostname === "127.0.0.1" ||
    authHostname === "[::1]");

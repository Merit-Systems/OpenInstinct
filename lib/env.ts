import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { isE164PhoneNumber } from "../auth/phone-number";
import { databaseUrlSchema } from "../db/env/utils";

const localDevelopment =
  process.env.NODE_ENV === "development" &&
  process.env.VERCEL_ENV === undefined;

const requiredValue = z
  .string()
  .refine((value) => value.trim().length > 0, "Required");

const betterAuthUrlSchema = requiredValue.refine(
  (value) => URL.canParse(value),
  "BETTER_AUTH_URL must be an absolute URL"
);

const secretEncryptionKeySchema = requiredValue.refine(
  (value) => Buffer.from(value, "base64").length === 32,
  "SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key."
);

function requiredValueWithLocalDefault<T extends z.ZodType<string, string>>(
  schema: T,
  localDefault: z.util.NoUndefined<z.output<T>>
) {
  return localDevelopment ? schema.default(localDefault) : schema;
}

export const env = createEnv({
  server: {
    // Required
    DATABASE_URL: databaseUrlSchema,
    KERNEL_API_KEY: requiredValue,

    // Required with local defaults
    BETTER_AUTH_SECRET: requiredValueWithLocalDefault(
      requiredValue,
      "openinstinct-local-auth-development-secret"
    ),
    BETTER_AUTH_URL: requiredValueWithLocalDefault(
      betterAuthUrlSchema,
      "http://localhost:3000"
    ),
    SECRET_ENCRYPTION_KEY: requiredValueWithLocalDefault(
      secretEncryptionKeySchema,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    ),

    // Optional
    BLOB_READ_WRITE_TOKEN: requiredValue.optional(),
    BLOB_STORE_ID: requiredValue.optional(),
    AGENTCASH_ALLOWED_USER_IDS: requiredValue.optional(),
    AGENTCASH_MAX_PAYMENT_USD: z.coerce.number().positive().max(100).default(5),
    COINBASE_ALLOWED_USER_IDS: requiredValue.optional(),
    COINBASE_KEY_ID: requiredValue.optional(),
    COINBASE_KEY_SECRET: requiredValue.optional(),
    GOOGLE_CONNECTOR_UID: requiredValue.default("google/open-instinct"),
    LINQ_CONNECTOR: requiredValue.optional(),
    LINQ_PHONE_NUMBER: requiredValue
      .refine(
        (value) => isE164PhoneNumber(value),
        "LINQ_PHONE_NUMBER must use E.164 format"
      )
      .optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("production"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    X402_PRIVATE_KEY: z
      .string()
      .regex(
        /^0x[0-9a-fA-F]{64}$/u,
        "X402_PRIVATE_KEY must be a 32-byte hex key."
      )
      .optional(),
    X402_SOLANA_PRIVATE_KEY: requiredValue.optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

if (
  (env.LINQ_CONNECTOR === undefined) !==
  (env.LINQ_PHONE_NUMBER === undefined)
) {
  throw new Error(
    "LINQ_CONNECTOR and LINQ_PHONE_NUMBER must be configured together."
  );
}
if (
  (env.COINBASE_KEY_ID === undefined) !==
  (env.COINBASE_KEY_SECRET === undefined)
) {
  throw new Error(
    "COINBASE_KEY_ID and COINBASE_KEY_SECRET must be configured together."
  );
}
const authHostname = new URL(env.BETTER_AUTH_URL).hostname;

export const localPhoneAuthBypassEnabled =
  localDevelopment &&
  (authHostname === "localhost" ||
    authHostname.endsWith(".localhost") ||
    authHostname === "127.0.0.1" ||
    authHostname === "[::1]");

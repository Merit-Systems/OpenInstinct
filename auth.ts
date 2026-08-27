import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { Pool } from "pg";
import { z } from "zod";
import { isE164PhoneNumber } from "@/lib/phone-number";
import { getEnv } from "@/lib/runtime-env";

const FALLBACK_DATABASE_URL =
  "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured";
const FALLBACK_AUTH_SECRET = "local-vault-assistant-auth-is-unconfigured";
const AUTH_MIGRATION_LOCK_ID = 1_972_040_815;
const AUTH_TABLE_NAMES = [
  "account",
  "session",
  "user",
  "verification",
] as const;
const authSchemaReadinessSchema = z.object({ ready: z.boolean() });
const textbeltResponseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true) }),
  z.object({ error: z.string().optional(), success: z.literal(false) }),
]);

const env = getEnv();
const databaseUrl =
  env.DATABASE_URL?.startsWith("postgres://") ||
  env.DATABASE_URL?.startsWith("postgresql://")
    ? withExplicitVerifiedSsl(env.DATABASE_URL)
    : FALLBACK_DATABASE_URL;

const authPool = new Pool({ connectionString: databaseUrl, max: 5 });

function withExplicitVerifiedSsl(value: string) {
  const url = new URL(value);
  const sslMode = url.searchParams.get("sslmode");
  if (
    sslMode === "prefer" ||
    sslMode === "require" ||
    sslMode === "verify-ca"
  ) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

export const auth = betterAuth({
  appName: "Local Vault Assistant",
  baseURL: env.BETTER_AUTH_URL ?? "http://auth-disabled.localhost",
  database: authPool,
  disabledPaths: [
    "/change-email",
    "/request-password-reset",
    "/reset-password",
    "/reset-password/:token",
    "/send-verification-email",
    "/sign-in/email",
    "/sign-in/social",
    "/sign-up/email",
    "/verify-email",
  ],
  plugins: [
    phoneNumber({
      allowedAttempts: 3,
      expiresIn: 300,
      phoneNumberValidator: isE164PhoneNumber,
      requireVerification: true,
      sendOTP: ({ code, phoneNumber: to }) => sendPhoneCode({ code, to }),
      signUpOnVerification: {
        getTempEmail: (phoneNumberValue) =>
          `phone-${createHash("sha256")
            .update(phoneNumberValue)
            .digest("hex")}@local-vault.invalid`,
        getTempName: () => "Phone user",
      },
    }),
  ],
  secret: env.BETTER_AUTH_SECRET ?? FALLBACK_AUTH_SECRET,
});

let migrationPromise: Promise<void> | undefined;

export async function ensureAuthDatabase() {
  requireAuthConfiguration();

  const currentMigration = (migrationPromise ??= prepareAuthDatabase());
  try {
    await currentMigration;
  } catch (error) {
    if (migrationPromise === currentMigration) migrationPromise = undefined;
    throw error;
  }
}

async function prepareAuthDatabase() {
  if (await isAuthSchemaReady()) return;
  await runAuthMigrations();
}

async function isAuthSchemaReady() {
  const readinessResult = await authPool.query(
    `SELECT count(*) = $1 AS ready
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = ANY($2::text[])`,
    [AUTH_TABLE_NAMES.length, AUTH_TABLE_NAMES]
  );
  const readiness = authSchemaReadinessSchema.parse(readinessResult.rows[0]);
  return readiness.ready;
}

async function runAuthMigrations() {
  const lockClient = await authPool.connect();
  let lockAcquired = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [
      AUTH_MIGRATION_LOCK_ID,
    ]);
    lockAcquired = true;
    if (await isAuthSchemaReady()) return;
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  } finally {
    try {
      if (lockAcquired) {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [
          AUTH_MIGRATION_LOCK_ID,
        ]);
      }
    } finally {
      lockClient.release();
    }
  }
}

function requireAuthConfiguration() {
  if (
    !env.DATABASE_URL?.startsWith("postgres://") &&
    !env.DATABASE_URL?.startsWith("postgresql://")
  ) {
    throw new Error("A Postgres DATABASE_URL is required.");
  }
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }
  if (!env.TEXTBELT_API_KEY) {
    throw new Error("TEXTBELT_API_KEY is required.");
  }
  if (!env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is required.");
  }
}

async function sendPhoneCode({ code, to }: { code: string; to: string }) {
  requireAuthConfiguration();
  const response = await fetch("https://textbelt.com/text", {
    body: JSON.stringify({
      key: env.TEXTBELT_API_KEY,
      message: `Eve sign-in code: ${code}. Expires in 5 minutes.`,
      phone: to,
      sender: "Eve",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Textbelt SMS failed with HTTP ${String(response.status)}.`
    );
  }
  const result = textbeltResponseSchema.parse(await response.json());
  if (!result.success) {
    throw new Error(
      `Textbelt SMS failed: ${result.error ?? "Unknown provider error"}`
    );
  }
}

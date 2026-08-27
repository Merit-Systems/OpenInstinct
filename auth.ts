import { createHash } from "node:crypto";
import { createSMSSender, type SMSTemplateId } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { Pool } from "pg";
import { z } from "zod";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { isE164PhoneNumber } from "@/lib/phone-number";
import { getEnv } from "@/lib/runtime-env";

const LOCAL_UNUSED_DATABASE_URL =
  "postgresql://local:local@127.0.0.1:1/local_unused";
const LOCAL_UNUSED_SECRET = "local-vault-assistant-auth-is-disabled-locally";
const AUTH_MIGRATION_LOCK_ID = 1_972_040_815;
const AUTH_TABLE_NAMES = [
  "account",
  "session",
  "user",
  "verification",
] as const;
const authSchemaReadinessSchema = z.object({ ready: z.boolean() });

const env = getEnv();
const databaseUrl =
  env.DATABASE_URL?.startsWith("postgres://") ||
  env.DATABASE_URL?.startsWith("postgresql://")
    ? env.DATABASE_URL
    : LOCAL_UNUSED_DATABASE_URL;

const authPool = new Pool({ connectionString: databaseUrl, max: 5 });

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
      sendOTP: ({ code, phoneNumber: to }) =>
        sendPhoneCode({ code, template: "sign-in-otp", to }),
      signUpOnVerification: {
        getTempEmail: (phoneNumberValue) =>
          `phone-${createHash("sha256")
            .update(phoneNumberValue)
            .digest("hex")}@local-vault.invalid`,
        getTempName: () => "Phone user",
      },
    }),
  ],
  secret: env.BETTER_AUTH_SECRET ?? LOCAL_UNUSED_SECRET,
});

let migrationPromise: Promise<void> | undefined;

export async function ensureAuthDatabase() {
  if (getDeploymentMode() === "local") return;
  requireHostedAuthConfiguration();

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

function requireHostedAuthConfiguration() {
  if (
    !env.DATABASE_URL?.startsWith("postgres://") &&
    !env.DATABASE_URL?.startsWith("postgresql://")
  ) {
    throw new Error("A Postgres DATABASE_URL is required in hosted mode.");
  }
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required in hosted mode.");
  }
  if (!env.BETTER_AUTH_INFRA_API_KEY) {
    throw new Error("BETTER_AUTH_INFRA_API_KEY is required in hosted mode.");
  }
  if (!env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is required in hosted mode.");
  }
}

async function sendPhoneCode({
  code,
  template,
  to,
}: {
  code: string;
  template: SMSTemplateId;
  to: string;
}) {
  if (getDeploymentMode() === "local") {
    throw new Error("Phone authentication is disabled in local mode.");
  }
  requireHostedAuthConfiguration();
  const result = await createSMSSender({
    apiKey: env.BETTER_AUTH_INFRA_API_KEY,
  }).send({ code, template, to });
  if (!result.success) {
    throw new Error(
      `Better Auth Infra SMS failed: ${result.error ?? "Unknown provider error"}`
    );
  }
}

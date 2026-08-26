import { createHash } from "node:crypto";
import { createSMSSender, type SMSTemplateId } from "@better-auth/infra";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { twoFactor } from "better-auth/plugins/two-factor";
import { Pool } from "pg";
import { z } from "zod";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { getEnv } from "@/lib/runtime-env";

const LOCAL_UNUSED_DATABASE_URL =
  "postgresql://local:local@127.0.0.1:1/local_unused";
const LOCAL_UNUSED_SECRET = "local-vault-assistant-auth-is-disabled-locally";
const AUTH_MIGRATION_LOCK_ID = 1_972_040_815;
const phoneUserSchema = z.object({ phoneNumber: z.string().min(1) });

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
    "/two-factor/generate-backup-codes",
    "/two-factor/get-totp-uri",
    "/two-factor/verify-backup-code",
    "/two-factor/verify-totp",
    "/verify-email",
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  plugins: [
    phoneNumber({
      allowedAttempts: 3,
      expiresIn: 300,
      phoneNumberValidator: (value) => /^\+[1-9]\d{7,14}$/.test(value),
      requireVerification: true,
      sendOTP: ({ code, phoneNumber: to }) =>
        sendPhoneCode({ code, template: "phone-verification", to }),
      sendPasswordResetOTP: ({ code, phoneNumber: to }) =>
        sendPhoneCode({ code, template: "phone-verification", to }),
      signUpOnVerification: {
        getTempEmail: (phoneNumberValue) =>
          `phone-${createHash("sha256")
            .update(phoneNumberValue)
            .digest("hex")}@local-vault.invalid`,
        getTempName: () => "Phone user",
      },
    }),
    twoFactor({
      accountLockout: {
        durationSeconds: 900,
        enabled: true,
        maxFailedAttempts: 5,
      },
      issuer: "Local Vault Assistant",
      otpOptions: {
        allowedAttempts: 3,
        digits: 6,
        period: 5,
        sendOTP: ({ otp: code, user }) => {
          const parsedUser = phoneUserSchema.safeParse(user);
          if (!parsedUser.success) {
            throw new Error("A verified phone number is required for 2FA.");
          }
          return sendPhoneCode({
            code,
            template: "two-factor",
            to: parsedUser.data.phoneNumber,
          });
        },
        storeOTP: "hashed",
      },
      totpOptions: { disable: true },
      trustDeviceMaxAge: 0,
      twoFactorCookieMaxAge: 600,
    }),
  ],
  secret: env.BETTER_AUTH_SECRET ?? LOCAL_UNUSED_SECRET,
});

let migrationPromise: Promise<void> | undefined;

export async function ensureAuthDatabase() {
  if (getDeploymentMode() === "local") return;
  requireHostedAuthConfiguration();

  const currentMigration = (migrationPromise ??= runAuthMigrations());
  try {
    await currentMigration;
  } catch (error) {
    if (migrationPromise === currentMigration) migrationPromise = undefined;
    throw error;
  }
}

async function runAuthMigrations() {
  const lockClient = await authPool.connect();
  let lockAcquired = false;
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [
      AUTH_MIGRATION_LOCK_ID,
    ]);
    lockAcquired = true;
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
    throw new Error("The authentication code could not be sent.");
  }
}

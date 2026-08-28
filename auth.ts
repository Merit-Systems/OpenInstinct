import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { authSchema } from "@/lib/db/schema";
import { isE164PhoneNumber } from "@/lib/phone-number";
import { getEnv, isLocalPhoneAuthBypassEnabled } from "@/lib/runtime-env";
import { database, db } from "@/lib/server/database";
import { sendLinqText } from "@/lib/server/linq";

const FALLBACK_AUTH_SECRET = "local-vault-assistant-auth-is-unconfigured";

const env = getEnv();
const localPhoneAuthBypass = isLocalPhoneAuthBypassEnabled(env);

export const auth = betterAuth({
  appName: "Local Vault Assistant",
  baseURL: env.BETTER_AUTH_URL ?? "http://auth-disabled.localhost",
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
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
      sendOTP: localPhoneAuthBypass
        ? () => undefined
        : ({ code, phoneNumber: to }) => sendPhoneCode({ code, to }),
      signUpOnVerification: {
        getTempEmail: (phoneNumberValue) =>
          `phone-${createHash("sha256")
            .update(phoneNumberValue)
            .digest("hex")}@local-vault.invalid`,
        getTempName: () => "Phone user",
      },
      verifyOTP: localPhoneAuthBypass
        ? ({ phoneNumber: value }) => isE164PhoneNumber(value)
        : undefined,
    }),
  ],
  secret: env.BETTER_AUTH_SECRET ?? FALLBACK_AUTH_SECRET,
});

export function ensureAuthDatabase() {
  requireAuthConfiguration();
  database();
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
  if (!env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is required.");
  }
}

async function sendPhoneCode({ code, to }: { code: string; to: string }) {
  requireAuthConfiguration();
  await sendLinqText({
    idempotencyKey: `auth-otp-${createHash("sha256")
      .update(`${to}\u0000${code}`)
      .digest("hex")}`,
    message: `Local Vault Assistant sign-in code: ${code}. Expires in 5 minutes.`,
    to,
  });
}

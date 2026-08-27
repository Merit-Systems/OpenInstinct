import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { getToken } from "@vercel/connect";
import { account, db, session, user, verification } from "@/db";
import { env, localPhoneAuthBypassEnabled } from "@/lib/env";
import { isE164PhoneNumber } from "@/lib/auth/phone-number";
import { LINQ_CONNECTOR } from "@/lib/linq";

const LINQ_MESSAGES_URL = "https://api.linqapp.com/api/partner/v3/messages";
export const auth = betterAuth({
  appName: "Local Vault Assistant",
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { account, session, user, verification },
  }),
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
      sendOTP: localPhoneAuthBypassEnabled
        ? () => undefined
        : ({ code, phoneNumber: to }) => sendPhoneCode({ code, to }),
      signUpOnVerification: {
        getTempEmail: (phoneNumberValue) =>
          `phone-${createHash("sha256")
            .update(phoneNumberValue)
            .digest("hex")}@local-vault.invalid`,
        getTempName: () => "Phone user",
      },
      verifyOTP: localPhoneAuthBypassEnabled
        ? ({ phoneNumber: value }) => isE164PhoneNumber(value)
        : undefined,
    }),
  ],
  secret: env.BETTER_AUTH_SECRET,
});

async function sendPhoneCode({ code, to }: { code: string; to: string }) {
  await sendLinqText({
    idempotencyKey: `auth-otp-${createHash("sha256")
      .update(`${to}\u0000${code}`)
      .digest("hex")}`,
    message: `Local Vault Assistant sign-in code: ${code}. Expires in 5 minutes.`,
    to,
  });
}

async function sendLinqText({
  idempotencyKey,
  message,
  to,
}: {
  readonly idempotencyKey: string;
  readonly message: string;
  readonly to: string;
}) {
  const token = await getToken(LINQ_CONNECTOR, {
    subject: { type: "app" },
  });
  const response = await fetch(LINQ_MESSAGES_URL, {
    body: JSON.stringify({
      message: { parts: [{ type: "text", value: message }] },
      to: [to],
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Linq message delivery failed with HTTP ${String(response.status)}.`
    );
  }
}

import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { account, db, session, user, verification } from "@/db";
import { recordVerifiedPhoneIdentity } from "@/db/services/phone-identities";
import { betterAuthBaseURL } from "@/lib/application-origin";
import { env, localPhoneAuthBypassEnabled } from "@/env";
import { getInstallationSecrets } from "@/lib/installation-secrets";
import { LinqDeliveryError, linqOtpFailure, sendLinqText } from "./linq";
import { isE164PhoneNumber } from "./phone-number";

let authPromise: ReturnType<typeof createAuth> | undefined;

export interface PhoneAuthDependencies {
  readonly localPhoneAuthBypassEnabled: boolean;
  recordVerifiedPhoneIdentity(input: {
    readonly phoneNumber: string;
    readonly userId: string;
  }): Promise<void>;
  sendPhoneCode(input: {
    readonly code: string;
    readonly to: string;
  }): Promise<void>;
}

export function getAuth() {
  authPromise ??= initializeAuthWithRetry();
  return authPromise;
}

async function initializeAuthWithRetry() {
  try {
    return await createAuth();
  } catch (error) {
    authPromise = undefined;
    throw error;
  }
}

export async function createAuth() {
  const { betterAuthSecret } = await getInstallationSecrets();
  return betterAuth({
    appName: "Local Vault Assistant",
    baseURL: betterAuthBaseURL(),
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
      phoneNumber(
        createPhoneNumberOptions({
          localPhoneAuthBypassEnabled,
          async recordVerifiedPhoneIdentity(input) {
            await recordVerifiedPhoneIdentity(input);
          },
          sendPhoneCode,
        })
      ),
    ],
    secret: betterAuthSecret,
  });
}

export function createPhoneNumberOptions(
  dependencies: PhoneAuthDependencies
): Parameters<typeof phoneNumber>[0] {
  return {
    allowedAttempts: 3,
    expiresIn: 300,
    phoneNumberValidator: isE164PhoneNumber,
    requireVerification: true,
    callbackOnVerification: async ({ phoneNumber: phoneNumberValue, user }) => {
      try {
        await dependencies.recordVerifiedPhoneIdentity({
          phoneNumber: phoneNumberValue,
          userId: user.id,
        });
      } catch (error) {
        console.error(
          "Failed to record verified phone identity.",
          error instanceof Error ? error.name : "UnknownError"
        );
      }
    },
    sendOTP: dependencies.localPhoneAuthBypassEnabled
      ? () => undefined
      : ({ code, phoneNumber: to }) => dependencies.sendPhoneCode({ code, to }),
    signUpOnVerification: {
      getTempEmail: (phoneNumberValue) =>
        `phone-${createHash("sha256")
          .update(phoneNumberValue)
          .digest("hex")}@local-vault.invalid`,
      getTempName: () => "Phone user",
    },
    verifyOTP: dependencies.localPhoneAuthBypassEnabled
      ? ({ phoneNumber: value }) => isE164PhoneNumber(value)
      : undefined,
  };
}

export async function sendPhoneCode({
  code,
  to,
}: {
  readonly code: string;
  readonly to: string;
}) {
  if (!env.LINQ_CONNECTOR) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "LINQ_NOT_CONFIGURED",
      message:
        "iMessage sign-in is not configured. Attach a Linq connector to this deployment.",
    });
  }

  try {
    await sendLinqText({
      connector: env.LINQ_CONNECTOR,
      idempotencyKey: `auth-otp-${createHash("sha256")
        .update(`${to}\u0000${code}`)
        .digest("hex")}`,
      message: `Local Vault Assistant sign-in code: ${code}. Expires in 5 minutes.`,
      to,
    });
  } catch (error) {
    if (error instanceof LinqDeliveryError) {
      const failure = linqOtpFailure(error);
      throw new APIError("BAD_GATEWAY", {
        code: failure.code,
        linqError: {
          code: error.code,
          message: error.linqMessage,
          status: error.status,
          trace_id: error.traceId,
        },
        message: failure.message,
      });
    }

    throw new APIError("BAD_GATEWAY", {
      code: "LINQ_CONNECTOR_UNAVAILABLE",
      message:
        "This deployment cannot access its Linq connector. Check LINQ_CONNECTOR and the connector's Vercel project attachment.",
    });
  }
}

import { type BlooioApiError, sendBlooioText } from "@shared/blooio/api";
import { env } from "@shared/environment";

export function blooioOtpFailure(error: BlooioApiError) {
  if (error.status === 429) {
    return {
      code: "BLOOIO_CONVERSATION_LIMITED",
      message:
        "Blooio is temporarily limiting messages to this number. Wait a moment, then request another code.",
    };
  }
  if (error.status === 404) {
    return {
      code: "BLOOIO_SENDER_UNAVAILABLE",
      message:
        "No Blooio number is available to send a sign-in code. Check BLOOIO_API_KEY and BLOOIO_FROM_NUMBER, then try again.",
    };
  }
  return {
    code: "BLOOIO_DELIVERY_FAILED",
    message:
      "Blooio could not send a sign-in code. Check the API key and sending number, then try again.",
  };
}

export async function sendBlooioSignInCode({
  idempotencyKey,
  message,
  to,
}: {
  readonly idempotencyKey: string;
  readonly message: string;
  readonly to: string;
}) {
  const apiKey = env.BLOOIO_API_KEY;
  if (!apiKey) {
    throw new Error("BLOOIO_API_KEY is not configured.");
  }
  await sendBlooioText({
    from: env.BLOOIO_FROM_NUMBER,
    idempotencyKey,
    message,
    to,
  });
}

import { getToken } from "@vercel/connect";
import { LINQ_CONNECTOR } from "@/lib/linq";

const LINQ_MESSAGES_URL = "https://api.linqapp.com/api/partner/v3/messages";

export async function sendLinqText({
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

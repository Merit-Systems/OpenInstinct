import { getToken } from "@vercel/connect";
import { z } from "zod";

const LINQ_MESSAGES_URL = "https://api.linqapp.com/api/partner/v3/messages";
const linqErrorResponseSchema = z.object({
  code: z.number().int().optional(),
  message: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
});

export const linqDeliveryDependencies = { getToken };

export class LinqDeliveryError extends Error {
  readonly code: number | undefined;
  readonly linqMessage: string | undefined;
  readonly status: number;
  readonly traceId: string | undefined;

  constructor({
    code,
    linqMessage,
    status,
    traceId,
  }: {
    readonly code?: number;
    readonly linqMessage?: string;
    readonly status: number;
    readonly traceId?: string;
  }) {
    const diagnostics = [
      code === undefined ? undefined : `code ${String(code)}`,
      linqMessage,
      traceId === undefined ? undefined : `trace_id ${traceId}`,
    ].filter((value) => value !== undefined);
    super(
      `Linq message delivery failed with HTTP ${String(status)}${
        diagnostics.length === 0 ? "" : ` (${diagnostics.join("; ")})`
      }.`
    );
    this.name = "LinqDeliveryError";
    this.code = code;
    this.linqMessage = linqMessage;
    this.status = status;
    this.traceId = traceId;
  }
}

export function linqOtpFailure(error: LinqDeliveryError) {
  switch (error.code) {
    case 2015:
      return {
        code: "LINQ_CONTACT_NOT_ALLOWED",
        message:
          "This phone number is not in this deployment's Linq Messaging Contacts. Add it in Vercel Connect, then try again.",
      };
    case 2024:
      return {
        code: "LINQ_RECIPIENT_OPTED_OUT",
        message:
          "This phone number has opted out of messages from this Linq line. Re-enable messages or use another phone number.",
      };
    case 2027:
      return {
        code: "LINQ_REPUTATION_BLOCKED",
        message:
          "This Linq line cannot send a code because of its messaging reputation. Review the line in Linq, then try again.",
      };
    default:
      return {
        code: "LINQ_DELIVERY_FAILED",
        message:
          "Linq could not send a sign-in code. Check the connector and its sending line, then try again.",
      };
  }
}

export async function sendLinqText({
  connector,
  idempotencyKey,
  message,
  to,
}: {
  readonly connector: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly to: string;
}) {
  const token = await linqDeliveryDependencies.getToken(connector, {
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
  if (response.ok) return;

  const body: unknown = await response.json().catch(() => undefined);
  const linqError = linqErrorResponseSchema.safeParse(body).data;
  throw new LinqDeliveryError({
    code: linqError?.code,
    linqMessage: linqError?.message,
    status: response.status,
    traceId: linqError?.trace_id,
  });
}

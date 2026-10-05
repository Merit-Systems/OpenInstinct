import { z } from "zod";
import { env } from "@shared/environment";
import { isE164PhoneNumber } from "@shared/identity/phone-number";

const blooioApiBase = "https://api.blooio.com/v4";

const blooioFailureSchema = z.union([
  z
    .object({
      error: z.object({
        code: z.string().optional(),
        message: z.string().optional(),
      }),
    })
    .transform((value) => ({
      code: value.error.code,
      message: value.error.message,
    })),
  z
    .object({
      error: z.string().optional(),
      message: z.string().optional(),
    })
    .transform((value) => ({
      code: value.error,
      message: value.message,
    })),
]);

type BlooioRequestBody =
  | BlooioChatMessage
  | {
      readonly channel_type: "blooio";
      readonly text: string;
      readonly to: string;
    }
  | { readonly from: string; readonly text: string; readonly to: string }
  | { readonly reaction: string }
  | { readonly state: "started" | "stopped" };

const blooioNumberSchema = z.object({
  is_active: z.boolean().optional(),
  phone_number: z.string().optional(),
});

export class BlooioApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor({
    code,
    message,
    status,
  }: {
    readonly code?: string;
    readonly message?: string;
    readonly status: number;
  }) {
    super(
      `Blooio request failed with HTTP ${String(status)}${
        message ? ` (${message})` : ""
      }.`
    );
    this.name = "BlooioApiError";
    this.code = code;
    this.status = status;
  }
}

export interface BlooioChatMessage {
  readonly attachments?: readonly string[];
  readonly reply_to?: string;
  readonly rich_link?: { readonly url: string };
  readonly text?: string;
}

export async function sendBlooioChatMessage(
  chatId: string,
  message: BlooioChatMessage,
  idempotencyKey?: string
) {
  await blooioPost(
    `/chats/${encodeURIComponent(chatId)}/messages`,
    message,
    idempotencyKey
  );
}

export async function sendBlooioText({
  from,
  idempotencyKey,
  message,
  to,
}: {
  readonly from?: string;
  readonly idempotencyKey: string;
  readonly message: string;
  readonly to: string;
}) {
  await blooioPost(
    "/messages",
    from
      ? { from, text: message, to }
      : { channel_type: "blooio", text: message, to },
    idempotencyKey
  );
}

const tapbacks = {
  exclamation: "emphasize",
  heart: "love",
  laugh: "laugh",
  question: "question",
  thumbs_down: "dislike",
  thumbs_up: "like",
} as const;

export async function sendBlooioReaction({
  chatId,
  messageId,
  operation,
  type,
}: {
  readonly chatId: string;
  readonly messageId: string;
  readonly operation: "add" | "remove";
  readonly type: keyof typeof tapbacks;
}) {
  const reaction = `${operation === "remove" ? "-" : "+"}${tapbacks[type]}`;
  await blooioPost(
    `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    { reaction }
  );
}

export async function setBlooioTyping(
  chatId: string,
  state: "started" | "stopped"
) {
  await blooioPost(`/chats/${encodeURIComponent(chatId)}/typing`, { state });
}

export async function markBlooioChatRead(chatId: string) {
  await blooioPost(`/chats/${encodeURIComponent(chatId)}/read`);
}

export async function readBlooioSendingNumber() {
  if (env.BLOOIO_FROM_NUMBER) return env.BLOOIO_FROM_NUMBER;
  if (!env.BLOOIO_API_KEY) return undefined;
  try {
    const body = await blooioGet("/me/numbers");
    const rows = z
      .object({ data: z.array(blooioNumberSchema).optional() })
      .safeParse(body).data?.data;
    return rows?.find(
      (row) =>
        row.is_active !== false &&
        row.phone_number !== undefined &&
        isE164PhoneNumber(row.phone_number)
    )?.phone_number;
  } catch {
    return undefined;
  }
}

async function blooioGet(path: string) {
  const response = await blooioFetch("GET", path);
  return readResponseJson(response);
}

async function blooioPost(
  path: string,
  body?: BlooioRequestBody,
  idempotencyKey?: string
) {
  await blooioFetch("POST", path, body, idempotencyKey);
}

async function blooioFetch(
  method: "GET" | "POST",
  path: string,
  body?: BlooioRequestBody,
  idempotencyKey?: string
) {
  const apiKey = env.BLOOIO_API_KEY;
  if (!apiKey) {
    throw new BlooioApiError({
      message: "BLOOIO_API_KEY is not configured",
      status: 503,
    });
  }
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await (method === "POST" && body !== undefined
    ? sendBlooioJson(path, headers, body)
    : fetch(`${blooioApiBase}${path}`, { headers, method }));
  if (response.ok) return response;
  const failure = blooioFailureSchema.safeParse(
    await readResponseJson(response)
  );
  throw new BlooioApiError({
    code: failure.success ? failure.data.code : undefined,
    message: failure.success ? failure.data.message : undefined,
    status: response.status,
  });
}

function sendBlooioJson(
  path: string,
  headers: Headers,
  body: BlooioRequestBody
) {
  headers.set("Content-Type", "application/json");
  return fetch(`${blooioApiBase}${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

async function readResponseJson(response: Response) {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return z.unknown().parse(JSON.parse(text));
}

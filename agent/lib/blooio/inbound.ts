import type { UserContent } from "ai";
import { z } from "zod";
import { env } from "@shared/environment";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { findVerifiedAuthUserIdByPhoneNumber } from "@db/services/auth/verified-phone";
import { verifyBlooioSignature } from "./signature";

const attachmentSchema = z.object({
  media_type: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

const envelopeSchema = z.object({
  data: z
    .object({
      attachments: z.array(attachmentSchema).optional(),
      channel_address: z.string().nullable().optional(),
      chat_id: z.string().optional(),
      contact: z
        .object({ identifier: z.string().optional() })
        .nullable()
        .optional(),
      direction: z.string().optional(),
      formatted_text: z.string().optional(),
      message_id: z.string().optional(),
      sender: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
    })
    .optional(),
  type: z.string(),
});

export interface BlooioInboundMessage {
  readonly attachments: readonly {
    readonly mediaType?: string;
    readonly url: string;
  }[];
  readonly chatId: string;
  readonly messageId: string;
  readonly phoneNumber: string;
  readonly text: string;
}

const seenMessageIds = new Set<string>();
const maximumSeenMessages = 1000;

export async function acceptBlooioWebhook(
  request: Request
): Promise<
  | { readonly message?: BlooioInboundMessage; readonly ok: true }
  | { readonly ok: false; readonly response: Response }
> {
  if (!env.BLOOIO_API_KEY) {
    return { ok: false, response: new Response("Not found", { status: 404 }) };
  }
  if (!env.BLOOIO_WEBHOOK_SECRET) {
    return {
      ok: false,
      response: new Response("Blooio webhook secret is not configured", {
        status: 503,
      }),
    };
  }
  const rawBody = await request.text();
  if (
    !verifyBlooioSignature(
      env.BLOOIO_WEBHOOK_SECRET,
      rawBody,
      request.headers.get("x-blooio-signature")
    )
  ) {
    return {
      ok: false,
      response: new Response("Invalid Blooio webhook", { status: 401 }),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      response: new Response("Invalid JSON", { status: 400 }),
    };
  }
  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return {
      ok: false,
      response: new Response("Invalid JSON", { status: 400 }),
    };
  }
  if (envelope.data.type !== "message.received") return { ok: true };
  const data = envelope.data.data;
  if (data?.direction !== "inbound") return { ok: true };
  const chatId = data.chat_id;
  const messageId = data.message_id;
  const phoneNumber = normalizeAuthPhoneNumber(
    data.sender ?? data.contact?.identifier ?? ""
  );
  if (!chatId || !messageId || !phoneNumber) return { ok: true };
  if (data.channel_address && data.sender === data.channel_address) {
    return { ok: true };
  }
  const attachments = (data.attachments ?? []).flatMap((attachment) =>
    attachment.url?.startsWith("https://")
      ? [
          {
            mediaType: attachment.media_type ?? undefined,
            url: attachment.url,
          },
        ]
      : []
  );
  const text = (data.formatted_text ?? data.text ?? "").trim();
  if (!text && attachments.length === 0) return { ok: true };
  return {
    message: { attachments, chatId, messageId, phoneNumber, text },
    ok: true,
  };
}

export function blooioUserContent(
  message: BlooioInboundMessage
): string | UserContent {
  if (message.attachments.length === 0) return message.text;
  return [
    ...(message.text ? [{ text: message.text, type: "text" as const }] : []),
    ...message.attachments.map((attachment) => ({
      data: new URL(attachment.url),
      mediaType: attachment.mediaType ?? "application/octet-stream",
      type: "file" as const,
    })),
  ];
}

export async function blooioInboundAuth(message: BlooioInboundMessage) {
  const verifiedUserId = await findVerifiedAuthUserIdByPhoneNumber(
    message.phoneNumber
  );
  if (!verifiedUserId) return undefined;
  const principalId = `better-auth:${verifiedUserId}`;
  const scope = accessScopeForUser(principalId);
  return {
    attributes: {
      blooioChatId: message.chatId,
      blooioMessageId: message.messageId,
      conversationChannel: "blooio",
      conversationId: `blooio:${message.chatId}`,
      phoneNumber: message.phoneNumber,
      workspaceId: scope.workspaceId,
    },
    authenticator: "blooio",
    principalId,
    principalType: "user" as const,
  };
}

export function claimBlooioDelivery(messageId: string) {
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > maximumSeenMessages) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest) seenMessageIds.delete(oldest);
  }
  return true;
}

import { messageToUserContent } from "eve/channels/chat-sdk";
import { z } from "zod";
import type { Message } from "chat";
import {
  formatMessageContext,
  messagePartReferenceSchema,
} from "@shared/chat/message-context";

const messageReferencesSchema = z.object({
  parts: z
    .array(messagePartReferenceSchema.omit({ partIndex: true }))
    .optional(),
  reply_to: z
    .object({
      message_id: z.string().optional(),
      part_index: z.number().int().nonnegative().optional(),
    })
    .nullish(),
});

export function linqMessageContent(message: Message) {
  const parsed = messageReferencesSchema.safeParse(message.raw);
  const references = parsed.success ? parsed.data : undefined;
  const hasApp = references?.parts?.some(
    (part) => part.type === "imessage_app"
  );
  if (!message.text.trim() && !message.attachments.length && !hasApp) return [];
  const content = messageToUserContent(message);
  const parts = (
    Array.isArray(content)
      ? content
      : [{ type: "text" as const, text: content }]
  ).filter((part) => part.type !== "text" || part.text.length > 0);
  const label = formatMessageContext({
    messageId: message.id,
    sender: message.author.isMe ? "openinstinct" : "user",
    parts: references?.parts?.map((part, partIndex) => ({
      partIndex,
      ...part,
    })),
    replyTo: references?.reply_to?.message_id
      ? {
          messageId: references.reply_to.message_id,
          partIndex: references.reply_to.part_index,
        }
      : undefined,
  });
  if (hasApp && !message.text.trim())
    parts.push({ type: "text", text: "[iMessage app card]" });
  return [{ type: "text" as const, text: label }, ...parts];
}

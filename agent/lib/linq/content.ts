import { messageToUserContent } from "eve/channels/chat-sdk";
import { z } from "zod";
import type { Message } from "chat";

const messageReferencesSchema = z.object({
  parts: z
    .array(
      z.object({
        type: z.string(),
        value: z.string().optional(),
        url: z.string().optional(),
        app: z.unknown().optional(),
        layout: z.unknown().optional(),
        fallback_text: z.string().nullish(),
        interactive: z.boolean().optional(),
      })
    )
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
  let label = `[Message: ${JSON.stringify({ messageId: message.id, sender: message.author.isMe ? "openinstinct" : "user" })}]`;
  if (references?.parts) {
    label += `\n[Parts: ${JSON.stringify(references.parts.map((part, partIndex) => ({ partIndex, ...part })))}]`;
  }
  if (references?.reply_to?.message_id) {
    label += `\n[Reply to: ${JSON.stringify({ messageId: references.reply_to.message_id, partIndex: references.reply_to.part_index })}]`;
  }
  if (hasApp && !message.text.trim())
    parts.push({ type: "text", text: "[iMessage app card]" });
  return [{ type: "text" as const, text: label }, ...parts];
}

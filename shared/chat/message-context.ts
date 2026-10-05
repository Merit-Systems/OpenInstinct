import { z } from "zod";

export const messagePartReferenceSchema = z.object({
  partIndex: z.number().int().nonnegative(),
  type: z.string(),
  value: z.string().optional(),
  url: z.string().optional(),
  app: z.unknown().optional(),
  layout: z.unknown().optional(),
  fallback_text: z.string().nullish(),
  interactive: z.boolean().optional(),
});

const messageHeaderSchema = z.object({
  messageId: z.string().min(1),
  sender: z.enum(["user", "openinstinct"]),
});
const replySchema = z.object({
  messageId: z.string().min(1),
  partIndex: z.number().int().nonnegative().optional(),
});
const messageContextSchema = messageHeaderSchema.extend({
  parts: z.array(messagePartReferenceSchema).optional(),
  replyTo: replySchema.optional(),
});

export function formatMessageContext(
  context: z.infer<typeof messageContextSchema>
) {
  let label = `[Message: ${JSON.stringify({ messageId: context.messageId, sender: context.sender })}]`;
  if (context.parts) label += `\n[Parts: ${JSON.stringify(context.parts)}]`;
  if (context.replyTo)
    label += `\n[Reply to: ${JSON.stringify(context.replyTo)}]`;
  return label;
}

export function parseMessageContext(text: string) {
  try {
    const lines = text.split("\n");
    const header = lines.shift();
    if (!header?.startsWith("[Message: ") || !header.endsWith("]"))
      return undefined;
    const metadata = messageHeaderSchema.parse(
      JSON.parse(header.slice(10, -1))
    );
    let parts: z.infer<typeof messagePartReferenceSchema>[] | undefined;
    let replyTo: z.infer<typeof replySchema> | undefined;
    for (const line of lines) {
      if (!line.endsWith("]")) return undefined;
      if (line.startsWith("[Parts: ") && parts === undefined)
        parts = messagePartReferenceSchema
          .array()
          .parse(JSON.parse(line.slice(8, -1)));
      else if (line.startsWith("[Reply to: ") && replyTo === undefined)
        replyTo = replySchema.parse(JSON.parse(line.slice(11, -1)));
      else return undefined;
    }
    return { ...metadata, parts, replyTo };
  } catch {
    return undefined;
  }
}

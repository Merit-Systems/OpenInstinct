import { z } from "zod";

export const SEND_MESSAGE_TOOL_NAME = "sendMessage";

export const conversationMessageSchema = z.object({
  message: z.string().trim().min(1),
});

export function conversationMessageFromOutput(
  toolName: string,
  output: unknown
) {
  if (toolName !== SEND_MESSAGE_TOOL_NAME) return undefined;
  const parsed = conversationMessageSchema.safeParse(output);
  return parsed.success ? parsed.data.message : undefined;
}

export function conversationMessageFromActionResult(result: unknown) {
  const parsed = z
    .object({
      kind: z.literal("tool-result"),
      output: conversationMessageSchema,
      toolName: z.literal(SEND_MESSAGE_TOOL_NAME),
    })
    .safeParse(result);
  return parsed.success ? parsed.data.output.message : undefined;
}

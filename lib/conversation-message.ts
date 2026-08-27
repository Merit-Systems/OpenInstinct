import { z } from "zod";

export const SEND_MESSAGE_TOOL_NAME = "sendMessage";

const CONVERSATION_MESSAGE_RELAYS_STATE_KEY = "conversationMessageRelays";

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

export function claimConversationMessageRelay(
  state: Record<string, unknown>,
  turnId: string,
  message: string
) {
  const relayKey = JSON.stringify([turnId, message]);
  const parsedRelayKeys = z
    .array(z.string())
    .safeParse(state[CONVERSATION_MESSAGE_RELAYS_STATE_KEY]);
  const relayKeys = parsedRelayKeys.success ? parsedRelayKeys.data : [];

  if (relayKeys.includes(relayKey)) return false;

  state[CONVERSATION_MESSAGE_RELAYS_STATE_KEY] = [
    ...relayKeys.slice(-31),
    relayKey,
  ];
  return true;
}

import { connectLinqCredentials } from "@vercel/connect/eve";
import { createLinqAdapter } from "@linqapp/chat-sdk-adapter";
import { LinqAPIV3 } from "@linqapp/sdk";
import { z } from "zod";
import { env } from "@shared/environment";
import type { reactToMessageInputSchema } from "@shared/chat/reaction";

export const linqCredentials = env.LINQ_CONNECTOR
  ? connectLinqCredentials(env.LINQ_CONNECTOR)
  : {
      apiKey() {
        throw new Error(
          "LINQ_CONNECTOR is not configured for this deployment."
        );
      },
    };

export async function sendNativeLinqMessage(
  chatId: string,
  message: Parameters<LinqAPIV3["chats"]["messages"]["send"]>[1]["message"],
  options?: Parameters<LinqAPIV3["chats"]["messages"]["send"]>[2]
) {
  const apiKey = await linqCredentials.apiKey();
  const client = new LinqAPIV3({ apiKey });
  return client.chats.messages.send(chatId, { message }, options);
}

export async function sendNativeLinqReaction(
  threadId: string,
  reaction: z.infer<typeof reactToMessageInputSchema>,
  signal: AbortSignal
) {
  const messageId = z
    .uuid({
      error:
        "The target messageId must be a valid Linq UUID without punctuation.",
    })
    .parse(reaction.messageId);
  const apiKey = await linqCredentials.apiKey();
  const adapter = createLinqAdapter({ credentials: () => ({ apiKey }) });
  const { chatId, pendingHandle } = adapter.decodeThreadId(threadId);
  if (!chatId || pendingHandle) {
    throw new Error("Reactions require an existing Linq conversation.");
  }
  const client = new LinqAPIV3({ apiKey, maxRetries: 0 });
  const target = await client.messages.retrieve(messageId, { signal });
  if (target.chat_id !== chatId) {
    throw new Error("Message target is not in the current conversation.");
  }
  signal.throwIfAborted();
  if (reaction.operation === "remove") {
    await adapter.removeReaction(threadId, messageId, reaction.emoji);
  } else {
    await adapter.addReaction(threadId, messageId, reaction.emoji);
  }
}

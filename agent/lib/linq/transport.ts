import { connectLinqCredentials } from "@vercel/connect/eve";
import { createLinqAdapter } from "@linqapp/chat-sdk-adapter";
import { vercelOidc } from "eve/channels/auth";
import type { LinqChannelCredentials } from "eve/channels/linq";
import { LinqAPIV3 } from "@linqapp/sdk";
import { z } from "zod";
import { env } from "@shared/environment";
import type { reactToMessageInputSchema } from "@shared/chat/reaction";

const linqCredentials = env.LINQ_CONNECTOR
  ? connectLinqCredentials(env.LINQ_CONNECTOR)
  : {
      apiKey() {
        throw new Error(
          "LINQ_CONNECTOR is not configured for this deployment."
        );
      },
    };

const authenticateWebhook = vercelOidc();
export const linqWebhookVerifier: NonNullable<
  LinqChannelCredentials["webhookVerifier"]
> = async (request) => (await authenticateWebhook(request)) ?? false;

export const linqAdapter = createLinqAdapter({
  credentials: async () => ({ apiKey: await linqCredentials.apiKey() }),
  webhookVerifier: env.LINQ_CONNECTOR ? linqWebhookVerifier : () => false,
});

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
  const { chatId, pendingHandle } = linqAdapter.decodeThreadId(threadId);
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
    await linqAdapter.removeReaction(threadId, messageId, reaction.emoji);
  } else {
    await linqAdapter.addReaction(threadId, messageId, reaction.emoji);
  }
}

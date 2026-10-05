import type { SessionContext } from "eve/context";
import type { ChannelContinuationOps } from "eve/channels";
import { z } from "zod";
import {
  BlooioApiError,
  sendBlooioChatMessage,
  sendBlooioReaction,
  setBlooioTyping,
} from "@shared/blooio/api";
import { resolveBlooioReplyTarget } from "@agent/lib/reply-targets";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "@agent/lib/linq-image-artifact/markdown";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const unavailableReplySchema = z.object({
  status: z.union([z.literal(404), z.literal(409)]),
});

export async function deliverBlooioAction(
  event: { readonly result?: unknown; readonly status?: string },
  channel: ChannelContinuationOps,
  session: SessionContext
) {
  const reaction = reactToMessageToolResultSchema.safeParse(event.result);
  if (event.status === "completed" && reaction.success) {
    const chatId = requireBlooioChatId(channel, session);
    const messageId = currentBlooioMessageId(session);
    if (!messageId) {
      throw new Error("react_to_message requires a current Blooio message.");
    }
    await sendBlooioReaction({
      chatId,
      messageId,
      operation: reaction.data.output.operation,
      type: reaction.data.output.type,
    });
    await stopTyping(chatId);
    await finalizeScheduledReportDelivery(session);
    return;
  }

  const message = sendMessageToolResultSchema.safeParse(event.result);
  if (
    event.status !== "completed" ||
    !message.success ||
    message.data.toolName !== "send_message"
  ) {
    return;
  }
  const chatId = requireBlooioChatId(channel, session);
  const report = scheduledReportFromSession(session);
  const replyTarget = resolveBlooioReplyTarget(
    message.data.output.replyTo,
    session.session.auth
  );
  const replyTo =
    replyTarget?.conversationId === `blooio:${chatId}`
      ? replyTarget.messageId
      : undefined;
  const idempotencyKey = report
    ? `scheduled-report:${report.runId}:${String(report.sequence)}`
    : undefined;

  if (message.data.output.kind === "link") {
    await sendBlooioMessage({
      chatId,
      idempotencyKey,
      message: { rich_link: { url: message.data.output.url } },
      replyTo,
    });
    await stopTyping(chatId);
    await finalizeScheduledReportDelivery(session);
    return;
  }

  const attachments = message.data.output.attachments?.map(
    (attachment) => attachment.url
  );
  const requestedText = message.data.output.text;
  if (!requestedText) {
    if (attachments?.length) {
      await sendBlooioMessage({
        chatId,
        idempotencyKey,
        message: { attachments },
        replyTo,
      });
    }
    await stopTyping(chatId);
    await finalizeScheduledReportDelivery(session);
    return;
  }

  const references = extractImageArtifactMarkdownReferences(requestedText);
  const stripped =
    references.length === 0
      ? requestedText
      : stripImageArtifactMarkdownReferences(requestedText);
  const failure =
    references.length === 0
      ? ""
      : references.length === 1
        ? "I couldn't attach the image."
        : `I couldn't attach ${String(references.length)} images.`;
  const text = [stripped, failure].filter(Boolean).join("\n\n");
  if (!text && !attachments?.length) {
    await stopTyping(chatId);
    await finalizeScheduledReportDelivery(session);
    return;
  }
  await sendBlooioMessage({
    chatId,
    idempotencyKey,
    message: {
      attachments,
      text: text || undefined,
    },
    replyTo,
  });
  await stopTyping(chatId);
  await finalizeScheduledReportDelivery(session);
}

export async function showBlooioTyping(
  channel: ChannelContinuationOps,
  session: SessionContext
) {
  const chatId = blooioChatId(channel, session);
  if (!chatId) return;
  try {
    await setBlooioTyping(chatId, "started");
  } catch (error) {
    console.warn("[blooio] typing indicator failed", { error });
  }
}

export async function deliverBlooioAuthorization(
  event: {
    readonly attemptId?: string;
    readonly authorization?: {
      readonly displayName?: string;
      readonly instructions?: string;
      readonly url?: string;
      readonly userCode?: string;
    };
    readonly candidateId?: string;
    readonly name: string;
    readonly turnId: string;
  },
  channel: ChannelContinuationOps,
  session: SessionContext
) {
  if (event.candidateId !== undefined) return;
  const chatId = blooioChatId(channel, session);
  if (!chatId) {
    throw new Error(
      "Authorization delivery requires an existing Blooio conversation."
    );
  }
  const displayName = event.authorization?.displayName ?? event.name;
  const idempotencyKey = `authorization:${session.session.id}:${event.attemptId ?? `${event.turnId}:${event.name}`}`;
  await sendBlooioChatMessage(
    chatId,
    {
      text: [
        event.authorization?.instructions ??
          `Connect ${displayName} to continue.`,
        event.authorization?.userCode
          ? `Code: ${event.authorization.userCode}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    `${idempotencyKey}:prompt`
  );
  if (event.authorization?.url) {
    await sendBlooioChatMessage(
      chatId,
      { rich_link: { url: event.authorization.url } },
      `${idempotencyKey}:link`
    );
  }
}

export async function finishBlooioTurn(
  event: { readonly finishReason?: string },
  session: SessionContext
) {
  if (event.finishReason === "tool-calls") return;
  await finalizeScheduledReportDelivery(
    session,
    scheduledReportFromSession(session) ? "suppressed" : "delivered"
  );
}

export function releaseBlooioTurn(session: SessionContext, message: string) {
  return releaseScheduledReportDelivery(session, message);
}

async function sendBlooioMessage({
  chatId,
  idempotencyKey,
  message,
  replyTo,
}: {
  readonly chatId: string;
  readonly idempotencyKey?: string;
  readonly message: {
    readonly attachments?: readonly string[];
    readonly rich_link?: { readonly url: string };
    readonly text?: string;
  };
  readonly replyTo?: string;
}) {
  const payload = {
    attachments: message.attachments,
    rich_link: message.rich_link,
    text: message.text,
  };
  try {
    await sendBlooioChatMessage(
      chatId,
      replyTo ? { ...payload, reply_to: replyTo } : payload,
      idempotencyKey
    );
  } catch (error) {
    if (!replyTo || !unavailableReplySchema.safeParse(error).success)
      throw error;
    console.warn("[blooio] reply target is unavailable", { replyTo });
    await sendBlooioChatMessage(
      chatId,
      payload,
      idempotencyKey ? `${idempotencyKey}:fallback` : undefined
    );
  }
}

function requireBlooioChatId(
  channel: ChannelContinuationOps,
  session: SessionContext
) {
  const chatId = blooioChatId(channel, session);
  if (!chatId) {
    throw new Error("send_message requires an active Blooio conversation.");
  }
  return chatId;
}

function blooioChatId(
  channel: ChannelContinuationOps,
  session: SessionContext
) {
  const token = channel.continuation?.token;
  if (token?.startsWith("chat_")) return token;
  const caller = session.session.auth.current ?? session.session.auth.initiator;
  if (caller?.attributes.conversationChannel !== "blooio") return undefined;
  const conversationId = z
    .string()
    .startsWith("blooio:")
    .safeParse(caller.attributes.conversationId);
  return conversationId.success
    ? conversationId.data.slice("blooio:".length)
    : undefined;
}

function currentBlooioMessageId(session: SessionContext) {
  const caller = session.session.auth.current;
  const messageId = z
    .string()
    .min(1)
    .safeParse(caller?.attributes.blooioMessageId);
  return messageId.success ? messageId.data : undefined;
}

async function stopTyping(chatId: string) {
  try {
    await setBlooioTyping(chatId, "stopped");
  } catch (error) {
    if (error instanceof BlooioApiError) return;
    console.warn("[blooio] clearing typing indicator failed", { error });
  }
}

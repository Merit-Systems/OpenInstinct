import type { AdapterPostableMessage } from "chat";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import {
  linqAdapter,
  sendNativeLinqMessage,
  sendNativeLinqReaction,
} from "@agent/lib/linq/transport";
import { prepareLinqImageArtifactDelivery } from "@agent/lib/linq-image-artifact/delivery";
import { resolveLinqReplyTarget } from "@agent/lib/reply-targets";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import {
  finalizeScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";
import type { reactToMessageInputSchema } from "@shared/chat/reaction";
import type { sendMessageOutputSchema } from "@shared/chat/message-delivery";

type OutboundMessage =
  | z.infer<typeof sendMessageOutputSchema>
  | ({ kind: "reaction" } & z.infer<typeof reactToMessageInputSchema>);

const unavailableReplyTargetSchema = z.object({
  status: z.union([z.literal(400), z.literal(404)]),
});

export async function deliverMessage(
  message: OutboundMessage,
  context: ToolContext,
  deliveryId?: string
) {
  const caller = context.session.auth.current;
  if (caller?.principalType !== "user")
    throw new Error(
      "Delivery requires the current authenticated Linq conversation or browser conversation."
    );
  context.abortSignal.throwIfAborted();
  if (caller.attributes.conversationChannel === "eve") {
    // In browser chat the successful tool result is the delivered message.
    await finalizeScheduledReportDelivery(context);
    return;
  }
  const thread = z
    .string()
    .startsWith("linq:")
    .safeParse(caller.attributes.conversationId);
  if (
    caller.attributes.conversationChannel !== "linq" ||
    !thread.success ||
    (caller.attributes.linqThreadId !== undefined &&
      caller.attributes.linqThreadId !== thread.data)
  )
    throw new Error(
      "Delivery requires the current authenticated Linq conversation. Nothing was sent."
    );
  const { chatId, pendingHandle } = linqAdapter.decodeThreadId(thread.data);
  if (!chatId || pendingHandle)
    throw new Error("Delivery requires an existing Linq conversation.");
  if (message.kind === "reaction") {
    await sendNativeLinqReaction(thread.data, message, context.abortSignal);
  } else {
    const report = scheduledReportFromSession(context);
    const idempotencyKey =
      deliveryId ??
      (report
        ? `scheduled-report:${report.runId}:${String(report.sequence)}`
        : `message:${context.session.id}:${context.callId}`);
    const replyTarget = resolveLinqReplyTarget(
      message.replyTo,
      context.session.auth
    );
    const replyMessageId =
      replyTarget?.conversationId === thread.data
        ? replyTarget.messageId
        : undefined;
    if (message.kind === "link") {
      await sendWithReplyFallback(replyMessageId, async (target) => {
        context.abortSignal.throwIfAborted();
        const nativeMessage: Parameters<typeof sendNativeLinqMessage>[1] = {
          parts: [{ type: "link", value: message.url }],
          idempotency_key: idempotencyKey,
        };
        if (target) nativeMessage.reply_to = { message_id: target };
        await sendNativeLinqMessage(chatId, nativeMessage, {
          signal: context.abortSignal,
        });
      });
    } else {
      const images = await prepareLinqImageArtifactDelivery(
        message.text ?? "",
        {
          rootSessionId: report?.workerSessionId ?? context.session.id,
          scope: scopeFromPrincipal(caller),
          signal: context.abortSignal,
        }
      );
      if (images.failedArtifactIds.length)
        console.warn("[linq] browser image delivery failed", {
          artifactIds: images.failedArtifactIds,
          sessionId: context.session.id,
        });
      const failure =
        images.failedArtifactIds.length === 0
          ? ""
          : images.failedArtifactIds.length === 1
            ? "I couldn't attach one image."
            : `I couldn't attach ${String(images.failedArtifactIds.length)} images.`;
      const outgoing: Extract<AdapterPostableMessage, { raw: string }> = {
        raw: [images.text, failure].filter(Boolean).join("\n\n"),
      };
      if (message.attachments?.length)
        outgoing.attachments = message.attachments.map(
          ({ kind, ...attachment }) => ({ ...attachment, type: kind })
        );
      if (images.files.length) outgoing.files = images.files;
      await sendWithReplyFallback(replyMessageId, async (replyToMessageId) => {
        context.abortSignal.throwIfAborted();
        await linqAdapter.postMessage(thread.data, outgoing, {
          idempotencyKey,
          replyToMessageId,
        });
      });
    }
  }
  await finalizeScheduledReportDelivery(context);
}

async function sendWithReplyFallback(
  target: string | undefined,
  send: (replyMessageId?: string) => Promise<void>
) {
  try {
    await send(target);
  } catch (error) {
    if (!target || !unavailableReplyTargetSchema.safeParse(error).success)
      throw error;
    console.warn("[linq] reply target is unavailable", {
      replyToMessageId: target,
    });
    await send();
  }
}

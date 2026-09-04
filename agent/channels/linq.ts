import { connectLinqCredentials } from "@vercel/connect/eve";
import { LinqAPIV3 } from "@linqapp/sdk";
import type { AdapterPostableMessage } from "chat";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { vercelOidc } from "eve/channels/auth";
import { z } from "zod";
import { resolveLinqReplyTarget } from "@agent/lib/reply-targets";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { getAuth } from "@db/services/auth";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { prepareLinqImageArtifactDelivery } from "../lib/linq-image-artifact/delivery";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";
import { env } from "@shared/environment";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});
const unavailableReplyTargetSchema = z.object({
  status: z.union([z.literal(400), z.literal(404)]),
});

type LinqMessageContent = Parameters<
  LinqAPIV3["chats"]["messages"]["send"]
>[1]["message"];

const trustedForwarder = vercelOidc();

// The Linq adapter only rejects a webhook when the verifier returns `false`,
// while eve's OIDC verifier reports failure as `null`. Translate explicitly so
// an unverified forwarder can never reach message dispatch.
export const linqWebhookVerifier: NonNullable<
  LinqChannelCredentials["webhookVerifier"]
> = async (request) => (await trustedForwarder(request)) ?? false;

const credentials = (
  env.LINQ_CONNECTOR
    ? {
        ...connectLinqCredentials(env.LINQ_CONNECTOR),
        webhookVerifier: linqWebhookVerifier,
      }
    : {
        apiKey() {
          throw new Error(
            "LINQ_CONNECTOR is not configured for this deployment."
          );
        },
        webhookVerifier: () => false,
      }
) satisfies LinqChannelCredentials;

export default linqChannel({
  credentials,
  events: {
    async "action.result"(event, context, session) {
      const reaction = reactToMessageToolResultSchema.safeParse(event.result);
      if (event.status === "completed" && reaction.success) {
        if (!context.thread) {
          throw new Error(
            "react_to_message requires an active Linq conversation thread."
          );
        }
        const messageId = context.thread.toJSON().currentMessage?.id;
        if (!messageId) {
          throw new Error("react_to_message requires a current Linq message.");
        }
        const adapter = context.bot.getAdapter("linq");
        if (reaction.data.output.operation === "remove") {
          await adapter.removeReaction(
            context.thread.id,
            messageId,
            reaction.data.output.type
          );
        } else {
          await adapter.addReaction(
            context.thread.id,
            messageId,
            reaction.data.output.type
          );
        }
        await finalizeScheduledReportDelivery(session);
        return;
      }

      const message = sendMessageToolResultSchema.safeParse(event.result);
      if (event.status === "completed" && message.success) {
        const { thread } = context;
        if (!thread) {
          throw new Error(
            "send_message requires an active Linq conversation thread."
          );
        }
        const report = scheduledReportFromSession(session);
        const replyTarget = resolveLinqReplyTarget(
          message.data.output.replyTo,
          session.session.auth
        );
        const requestedReplyMessageId =
          replyTarget?.conversationId === thread.id
            ? replyTarget.messageId
            : undefined;
        const idempotencyKey = report
          ? `scheduled-report:${report.runId}:${String(report.sequence)}`
          : undefined;
        const post = idempotencyKey
          ? (content: AdapterPostableMessage) =>
              context.bot
                .getAdapter("linq")
                .postMessage(thread.id, content, { idempotencyKey })
          : (content: AdapterPostableMessage) => thread.post(content);
        const resolveExistingChatId = () => {
          const adapter = context.bot.getAdapter("linq");
          const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
          if (pendingHandle || !chatId) {
            throw new Error("A Linq reply requires an existing conversation.");
          }
          return chatId;
        };

        if (message.data.output.kind === "link") {
          const { url } = message.data.output;
          const chatId = resolveExistingChatId();
          const apiKey = await credentials.apiKey();
          const client = new LinqAPIV3({ apiKey });
          const sendLink = (replyToMessageId?: string) => {
            const nativeMessage: LinqMessageContent = {
              parts: [{ type: "link", value: url }],
            };
            if (idempotencyKey) {
              nativeMessage.idempotency_key = idempotencyKey;
            }
            if (replyToMessageId) {
              nativeMessage.reply_to = { message_id: replyToMessageId };
            }
            return client.chats.messages.send(
              chatId,
              { message: nativeMessage },
              undefined
            );
          };
          try {
            await sendLink(requestedReplyMessageId);
          } catch (error) {
            if (
              !requestedReplyMessageId ||
              !unavailableReplyTargetSchema.safeParse(error).success
            ) {
              throw error;
            }
            console.warn("[linq] reply target is unavailable", {
              sessionId: session.session.id,
            });
            await sendLink();
          }
          await finalizeScheduledReportDelivery(session);
          return;
        }

        const attachments = message.data.output.attachments?.map(
          ({ kind, ...attachment }) => ({ ...attachment, type: kind })
        );
        const { text: requestedText } = message.data.output;
        if (!requestedText) {
          if (attachments?.length) {
            await post({ attachments, raw: "" });
            await finalizeScheduledReportDelivery(session);
            return;
          }
          await finalizeScheduledReportDelivery(session);
          return;
        }

        const caller =
          session.session.auth.current ?? session.session.auth.initiator;
        if (!caller) {
          const references =
            extractImageArtifactMarkdownReferences(requestedText);
          const text =
            references.length === 0
              ? requestedText
              : [
                  stripImageArtifactMarkdownReferences(requestedText),
                  "I couldn't attach the image.",
                ]
                  .filter(Boolean)
                  .join("\n\n");
          const outgoing: Extract<
            Parameters<typeof thread.post>[0],
            { raw: string }
          > = { raw: text };
          if (attachments?.length) outgoing.attachments = attachments;
          await sendLinqMessage({
            idempotencyKey,
            outgoing,
            post,
            resolveExistingChatId,
            replyToMessageId:
              attachments?.length === 0 ? requestedReplyMessageId : undefined,
          });
          await finalizeScheduledReportDelivery(session);
          return;
        }

        const delivery = await prepareLinqImageArtifactDelivery(requestedText, {
          rootSessionId: report?.workerSessionId ?? session.session.id,
          scope: scopeFromPrincipal(caller),
        });
        if (delivery.failedArtifactIds.length > 0) {
          console.warn("[linq] browser image delivery failed", {
            artifactIds: delivery.failedArtifactIds,
            sessionId: session.session.id,
          });
        }
        const failureMessage =
          delivery.failedArtifactIds.length === 0
            ? ""
            : delivery.failedArtifactIds.length === 1
              ? "I couldn't attach one image."
              : `I couldn't attach ${String(delivery.failedArtifactIds.length)} images.`;
        const text = [delivery.text, failureMessage]
          .filter(Boolean)
          .join("\n\n");
        const outgoing: Extract<
          Parameters<typeof thread.post>[0],
          { raw: string }
        > = { raw: text };
        if (attachments?.length) outgoing.attachments = attachments;
        if (delivery.files.length > 0) outgoing.files = delivery.files;
        await sendLinqMessage({
          idempotencyKey,
          outgoing,
          post,
          resolveExistingChatId,
          replyToMessageId:
            !attachments?.length && delivery.files.length === 0
              ? requestedReplyMessageId
              : undefined,
        });
        await finalizeScheduledReportDelivery(session);
      }
    },
    async "message.completed"(event, _context, session) {
      if (event.finishReason === "tool-calls") return;
      const report = scheduledReportFromSession(session);
      if (report) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "session.completed"(_event, _context, session) {
      const report = scheduledReportFromSession(session);
      if (report) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "turn.cancelled"(_event, _context, session) {
      await releaseScheduledReportDelivery(
        session,
        "Scheduled result reporting was cancelled."
      );
    },
    async "turn.failed"(event, _context, session) {
      await releaseScheduledReportDelivery(session, event.message);
    },
  },
  async onMessage(context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName = z.string().safeParse(message.author.userName);
    const phoneNumber = authorUserName.success
      ? normalizeAuthPhoneNumber(authorUserName.data)
      : undefined;
    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;
    if (!verifiedUserId || !phoneNumber) {
      // Phone possession is the only sign-in factor, so a handle that is not
      // linked to a verified user is unauthenticated: never mint a principal
      // or a workspace for it.
      console.warn("[linq] ignoring message from an unlinked handle", {
        threadId: context.thread.id,
      });
      return null;
    }
    const principalId = `better-auth:${verifiedUserId}`;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          conversationChannel: "linq",
          conversationId: context.thread.id,
          linqThreadId: context.thread.id,
          linqMessageId: message.id,
          phoneNumber,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

async function sendLinqMessage({
  idempotencyKey,
  outgoing,
  post,
  resolveExistingChatId,
  replyToMessageId,
}: {
  readonly idempotencyKey?: string;
  readonly outgoing: Extract<AdapterPostableMessage, { raw: string }>;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly resolveExistingChatId: () => string;
  readonly replyToMessageId?: string;
}) {
  if (!replyToMessageId) {
    await post(outgoing);
    return;
  }
  const chatId = resolveExistingChatId();
  const apiKey = await credentials.apiKey();
  const client = new LinqAPIV3({ apiKey });
  try {
    const nativeMessage: LinqMessageContent = {
      parts: [{ type: "text", value: outgoing.raw }],
      reply_to: { message_id: replyToMessageId },
    };
    if (idempotencyKey) {
      nativeMessage.idempotency_key = idempotencyKey;
    }
    await client.chats.messages.send(
      chatId,
      { message: nativeMessage },
      undefined
    );
    return;
  } catch (error) {
    if (!unavailableReplyTargetSchema.safeParse(error).success) throw error;
    console.warn("[linq] reply target is unavailable", {
      replyToMessageId,
    });
    await post(outgoing);
  }
}

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const auth = await getAuth();
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}

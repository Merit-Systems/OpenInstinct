import type { LinqAPIV3 } from "@linqapp/sdk";
import type { AdapterPostableMessage } from "chat";
import type { Message, Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createLinqAdapter } from "@linqapp/chat-sdk-adapter";
import {
  defaultLinqAuth,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { vercelOidc } from "eve/channels/auth";
import { z } from "zod";
import { resolveLinqReplyTarget } from "@agent/lib/reply-targets";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { getAuth } from "@db/services/auth";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { linqMessageContent } from "@agent/lib/linq/content";
import { prepareLinqImageArtifactDelivery } from "../lib/linq-image-artifact/delivery";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";
import { env } from "@shared/environment";
import {
  linqCredentials,
  sendNativeLinqMessage,
} from "@agent/lib/linq/transport";
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

const linqAdapter = createLinqAdapter({
  credentials: async () => ({ apiKey: await linqCredentials.apiKey() }),
  webhookVerifier: env.LINQ_CONNECTOR ? linqWebhookVerifier : () => false,
});

const linq = chatSdkChannel({
  adapters: { linq: linqAdapter },
  state: createMemoryState(),
  userName: "eve",
  concurrency: "concurrent",
  streaming: false,
  events: {
    async "authorization.required"(event, context, session) {
      const { thread } = context;
      if (!thread || event.candidateId !== undefined) return;
      const displayName = event.authorization?.displayName ?? event.name;
      if (!thread.isDM) {
        await thread.post({
          raw: `Connect ${displayName} in a direct message with this agent.`,
        });
        return;
      }
      const adapter = context.bot.getAdapter("linq");
      const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
      if (!chatId || pendingHandle)
        throw new Error(
          "Authorization delivery requires an existing Linq conversation."
        );
      const parts: NonNullable<LinqMessageContent["parts"]> = [
        {
          type: "text",
          value: [
            event.authorization?.instructions ??
              `Connect ${displayName} to continue.`,
            event.authorization?.userCode
              ? `Code: ${event.authorization.userCode}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];
      const idempotencyKey = `authorization:${session.session.id}:${event.attemptId ?? `${event.turnId}:${event.name}`}`;
      const result = await sendNativeLinqMessage(chatId, {
        parts,
        idempotency_key: `${idempotencyKey}:prompt`,
      });
      context.state.pendingAuthMessageIds = {
        ...context.state.pendingAuthMessageIds,
        [event.name]: result.message.id,
      };
      // Linq requires a native link to be the message's only part.
      if (event.authorization?.url)
        await sendNativeLinqMessage(chatId, {
          parts: [{ type: "link", value: event.authorization.url }],
          idempotency_key: `${idempotencyKey}:link`,
        });
    },
    async "action.result"(event, context, session) {
      const message = sendMessageToolResultSchema.safeParse(event.result);
      if (
        event.status === "completed" &&
        message.success &&
        message.data.toolName === "send_message"
      ) {
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
        const adapter = context.bot.getAdapter("linq");
        const post = idempotencyKey
          ? (content: AdapterPostableMessage) =>
              adapter.postMessage(thread.id, content, { idempotencyKey })
          : (content: AdapterPostableMessage) => thread.post(content);
        const postReply = (
          content: AdapterPostableMessage,
          replyToMessageId: string
        ) => {
          if (idempotencyKey) {
            return adapter.postMessage(thread.id, content, {
              idempotencyKey,
              replyToMessageId,
            });
          }
          return adapter.postMessage(thread.id, content, {
            replyToMessageId,
          });
        };
        const resolveExistingChatId = () => {
          const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
          if (pendingHandle || !chatId) {
            throw new Error("A Linq reply requires an existing conversation.");
          }
          return chatId;
        };

        if (message.data.output.kind === "link") {
          const { url } = message.data.output;
          const chatId = resolveExistingChatId();
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
            return sendNativeLinqMessage(chatId, nativeMessage);
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
            await sendLinqMessage({
              outgoing: { attachments, raw: "" },
              post,
              postReply,
              replyToMessageId: requestedReplyMessageId,
            });
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
            outgoing,
            post,
            postReply,
            replyToMessageId: requestedReplyMessageId,
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
          outgoing,
          post,
          postReply,
          replyToMessageId: requestedReplyMessageId,
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
});

async function onMessage(thread: Thread, message: Message) {
  if (message.author.isBot || message.author.isMe) return;

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
      threadId: thread.id,
    });
    return;
  }
  const principalId = `better-auth:${verifiedUserId}`;
  const scope = accessScopeForUser(principalId);
  const content = linqMessageContent(message);
  if (!content.length) return;
  try {
    await linqAdapter.markRead(thread.id, message.id);
  } catch {
    // A read receipt must not prevent dispatch.
  }
  await linq.send(content, {
    thread,
    auth: {
      ...auth,
      attributes: {
        ...auth.attributes,
        conversationChannel: "linq",
        conversationId: thread.id,
        linqThreadId: thread.id,
        linqMessageId: message.id,
        phoneNumber,
        workspaceId: scope.workspaceId,
      },
      principalId,
    },
  });
}

linq.bot.onDirectMessage(onMessage);
linq.bot.onNewMessage(/[\s\S]*/, onMessage);

export default linq.channel;

async function sendLinqMessage({
  outgoing,
  post,
  postReply,
  replyToMessageId,
}: {
  readonly outgoing: Extract<AdapterPostableMessage, { raw: string }>;
  readonly post: (
    content: AdapterPostableMessage
  ) => Promise<{ readonly id: string }>;
  readonly postReply: (
    content: AdapterPostableMessage,
    replyToMessageId: string
  ) => Promise<{ readonly id: string }>;
  readonly replyToMessageId?: string;
}) {
  if (!replyToMessageId) {
    await post(outgoing);
    return;
  }
  try {
    await postReply(outgoing, replyToMessageId);
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

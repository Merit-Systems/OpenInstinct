import { connectLinqCredentials } from "@vercel/connect/eve";
import { LinqAPIV3 } from "@linqapp/sdk";
import type { AdapterPostableMessage } from "chat";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { z } from "zod";
import { getAuth } from "@/auth";
import { reactToMessageToolResultSchema } from "@/agent/lib/react-to-message";
import { sendMessageToolResultSchema } from "@/agent/lib/send-message";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { accessScopeForUser, scopeFromPrincipal } from "@/lib/access-scope";
import { prepareLinqImageArtifactDelivery } from "../lib/linq-image-artifact/delivery";
import {
  extractImageArtifactMarkdownReferences,
  stripImageArtifactMarkdownReferences,
} from "../lib/linq-image-artifact/markdown";
import { env } from "@/env";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@/agent/lib/schedules/report-lifecycle";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

const credentials = (
  env.LINQ_CONNECTOR
    ? connectLinqCredentials(env.LINQ_CONNECTOR)
    : {
        apiKey() {
          throw new Error(
            "LINQ_CONNECTOR is not configured for this deployment."
          );
        },
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
        const idempotencyKey = report
          ? `scheduled-report:${report.runId}:${String(report.sequence)}`
          : undefined;
        const post = idempotencyKey
          ? (content: AdapterPostableMessage) =>
              context.bot
                .getAdapter("linq")
                .postMessage(thread.id, content, { idempotencyKey })
          : (content: AdapterPostableMessage) => thread.post(content);

        if (message.data.output.kind === "link") {
          const adapter = context.bot.getAdapter("linq");
          const { chatId, pendingHandle } = adapter.decodeThreadId(thread.id);
          if (pendingHandle || !chatId) {
            throw new Error(
              "A native link preview requires an existing Linq conversation."
            );
          }
          const apiKey = await credentials.apiKey();
          const client = new LinqAPIV3({ apiKey });
          await client.chats.messages.send(
            chatId,
            {
              message: {
                parts: [{ type: "link", value: message.data.output.url }],
              },
            },
            idempotencyKey ? { idempotencyKey } : undefined
          );
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
          await post(outgoing);
          await finalizeScheduledReportDelivery(session);
          return;
        }

        const delivery = await prepareLinqImageArtifactDelivery(
          requestedText,
          {
            rootSessionId: report?.workerSessionId ?? session.session.id,
            scope: scopeFromPrincipal(caller),
          }
        );
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
        await post(outgoing);
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
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);
    const attributes =
      verifiedUserId && phoneNumber
        ? {
            ...auth.attributes,
            conversationChannel: "linq",
            conversationId: context.thread.id,
            linqThreadId: context.thread.id,
            phoneNumber,
            workspaceId: scope.workspaceId,
          }
        : {
            ...auth.attributes,
            conversationChannel: "linq",
            conversationId: context.thread.id,
            linqThreadId: context.thread.id,
            workspaceId: scope.workspaceId,
          };
    return {
      auth: {
        ...auth,
        attributes,
        principalId,
      },
    };
  },
});

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

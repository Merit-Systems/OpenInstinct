/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelConfig,
  type LinqChannelCredentials,
} from "eve/channels/linq";
import { parseError } from "evlog";
import { useLogger as getEvlog } from "evlog/eve";
import { z } from "zod";
import { getAuth } from "@/auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { accessScopeForUser, scopeFromPrincipal } from "@/lib/access-scope";
import { prepareLinqBrowserImageDelivery } from "../lib/linq-browser-image-delivery";
import { prepareLinqArtifactDelivery } from "../lib/linq-artifact-delivery";
import {
  extractBrowserImageMarkdownReferences,
  stripBrowserImageMarkdownReferences,
} from "../lib/linq-browser-image-markdown";
import { env } from "@/env";
import { consumeWorkerCancellationTurn } from "../lib/worker-cancellation-delivery";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});
const taskCancelResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: z.object({ tasks: z.array(z.unknown()) }),
  toolName: z.literal("task_cancel"),
});
const cancelledWorkerTaskSchema = z.object({
  metadata: z.object({ name: z.literal("worker") }),
  status: z.literal("cancelled"),
  taskId: z.string(),
});
const workerCancellationsSchema = z.array(
  z.object({ sourceMessageId: z.string(), taskId: z.string() })
);
const markdownListItemPattern = /^\s*(?:[-+*]|\d+[.)])\s+/u;

type LinqThread = NonNullable<
  Parameters<
    NonNullable<NonNullable<LinqChannelConfig["events"]>["message.completed"]>
  >[1]["thread"]
>;
type LinqReplyPayload = Parameters<LinqThread["post"]>[0];

function splitLinqReply(message: string) {
  return message
    .trim()
    .split(/\r?\n[\t ]*\r?\n/u)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/u);
      return lines.every((line) => markdownListItemPattern.test(line))
        ? lines
        : block;
    })
    .map((part) => part.trim())
    .filter(Boolean);
}

async function postLinqReply(
  thread: LinqThread,
  markdown: string,
  files: readonly unknown[] = [],
  attachments: readonly unknown[] = []
) {
  const bubbles = splitLinqReply(markdown);
  if (bubbles.length === 0) {
    if (files.length > 0 || attachments.length > 0) {
      const payload: LinqReplyPayload = { markdown: "" };
      if (attachments.length > 0) payload.attachments = attachments;
      if (files.length > 0) payload.files = files;
      await thread.post(payload);
    }
    return;
  }
  /* oxlint-disable eslint/no-await-in-loop -- Reply bubbles must be posted in conversational order. */
  for (const [index, bubble] of bubbles.entries()) {
    if (
      index === bubbles.length - 1 &&
      (files.length > 0 || attachments.length > 0)
    ) {
      const payload: LinqReplyPayload = { markdown: bubble };
      if (attachments.length > 0) payload.attachments = attachments;
      if (files.length > 0) payload.files = files;
      await thread.post(payload);
    } else {
      await thread.post({ markdown: bubble });
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
}

const credentials: LinqChannelCredentials = env.LINQ_CONNECTOR
  ? connectLinqCredentials(env.LINQ_CONNECTOR)
  : {
      apiKey() {
        throw new Error(
          "LINQ_CONNECTOR is not configured for this deployment."
        );
      },
    };

export const linqChannelConfig = {
  credentials,
  events: {
    "action.result"(event, context) {
      const result = taskCancelResultSchema.safeParse(event.result);
      if (!result.success) return;

      const sourceMessageId = context.thread?.toJSON().currentMessage?.id;
      if (!sourceMessageId) return;

      const storedCancellations = workerCancellationsSchema.safeParse(
        context.state.workerCancellations
      );
      const cancellations = storedCancellations.success
        ? storedCancellations.data
        : [];
      for (const value of result.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) {
          cancellations.push({ sourceMessageId, taskId: task.data.taskId });
        }
      }
      context.state.workerCancellations = cancellations;
    },
    async "message.completed"(event, context, session) {
      if (event.finishReason === "tool-calls") {
        context.state.pendingToolCallMessage = event.message
          ? (event.message
              .split(/\r?\n/u)
              .map((line) => line.trim())
              .find(Boolean) ?? null)
          : null;
        let log: ReturnType<typeof getEvlog> | undefined;
        try {
          log = getEvlog(session);
        } catch (error) {
          console.warn("[linq] evlog unavailable", {
            error: parseError(error),
            sessionId: session.session.id,
            turnId: event.turnId,
          });
        }
        if (!context.thread) {
          const reaction = { outcome: "missing-thread" };
          if (log) {
            log.warn("Linq reaction skipped", {
              channel: { linq: { reactions: [reaction] } },
            });
          } else {
            console.warn("[linq] reaction skipped", {
              ...reaction,
              sessionId: session.session.id,
              turnId: event.turnId,
            });
          }
          return;
        }

        const messageId = context.thread.toJSON().currentMessage?.id;
        if (!messageId) {
          const reaction = {
            outcome: "missing-message-id",
            threadId: context.thread.id,
          };
          if (log) {
            log.warn("Linq reaction skipped", {
              channel: { linq: { reactions: [reaction] } },
            });
          } else {
            console.warn("[linq] reaction skipped", {
              ...reaction,
              sessionId: session.session.id,
              turnId: event.turnId,
            });
          }
          return;
        }

        if (context.state.acknowledgedLinqMessageId === messageId) {
          const reaction = {
            messageId,
            outcome: "already-acknowledged",
            threadId: context.thread.id,
          };
          if (log) {
            log.info("Linq reaction skipped", {
              channel: { linq: { reactions: [reaction] } },
            });
          } else {
            console.info("[linq] reaction skipped", {
              ...reaction,
              sessionId: session.session.id,
              turnId: event.turnId,
            });
          }
          return;
        }

        try {
          await context.bot
            .getAdapter("linq")
            .addReaction(context.thread.id, messageId, "thumbs_up");
          context.state.acknowledgedLinqMessageId = messageId;
          const reaction = {
            emoji: "thumbs_up",
            messageId,
            outcome: "accepted",
            threadId: context.thread.id,
          };
          if (log) {
            log.set({
              channel: { linq: { reactions: [reaction] } },
            });
          } else {
            console.info("[linq] reaction accepted", {
              ...reaction,
              sessionId: session.session.id,
              turnId: event.turnId,
            });
          }
        } catch (error) {
          const failure = parseError(error);
          const reaction = {
            emoji: "thumbs_up",
            error: failure,
            messageId,
            outcome: "failed",
            threadId: context.thread.id,
          };
          log?.warn("Linq reaction failed", {
            channel: {
              linq: {
                reactions: [reaction],
              },
            },
          });
          console.warn("[linq] reaction failed", {
            ...reaction,
            sessionId: session.session.id,
            turnId: event.turnId,
          });
        }
        return;
      }

      const cancelledTaskId = consumeWorkerCancellationTurn(
        session.session.id,
        event.turnId
      );
      const storedCancellations = workerCancellationsSchema.safeParse(
        context.state.workerCancellations
      );
      const cancellations = storedCancellations.success
        ? storedCancellations.data
        : [];
      const sourceMessageId = context.thread?.toJSON().currentMessage?.id;
      const cancellation = cancellations.find(
        (candidate) =>
          candidate.taskId === cancelledTaskId &&
          candidate.sourceMessageId === sourceMessageId
      );
      if (cancellation) {
        context.state.workerCancellations = cancellations.filter(
          (candidate) => candidate !== cancellation
        );
        context.state.pendingToolCallMessage = null;
        return;
      }

      context.state.pendingToolCallMessage = null;
      if (!event.message || !context.thread) return;

      // Eve's Linq adapter translates supported Markdown into native iMessage
      // decorations, so recipients see styled text instead of literal markers.
      const caller =
        session.session.auth.current ?? session.session.auth.initiator;
      if (!caller) {
        const references = extractBrowserImageMarkdownReferences(event.message);
        const markdown =
          references.length === 0
            ? event.message
            : [
                stripBrowserImageMarkdownReferences(event.message),
                "I couldn't attach the image.",
              ]
                .filter(Boolean)
                .join("\n\n");
        await postLinqReply(context.thread, markdown);
        return;
      }
      const scope = scopeFromPrincipal(caller);
      const [delivery, artifactDelivery] = await Promise.all([
        prepareLinqBrowserImageDelivery(event.message, {
          rootSessionId: session.session.id,
          scope,
        }),
        prepareLinqArtifactDelivery(event.message, { scope }),
      ]);
      if (delivery.failedArtifactIds.length > 0) {
        console.warn("[linq] browser image delivery failed", {
          artifactIds: delivery.failedArtifactIds,
          sessionId: session.session.id,
        });
      }
      if (artifactDelivery.failedArtifactIds.length > 0) {
        console.warn("[linq] artifact delivery failed", {
          artifactIds: artifactDelivery.failedArtifactIds,
          sessionId: session.session.id,
        });
      }
      const failedImageCount =
        delivery.failedArtifactIds.length +
        artifactDelivery.failedArtifactIds.length;
      const failureMessage =
        failedImageCount === 0
          ? ""
          : failedImageCount === 1
            ? "I couldn't attach one image."
            : `I couldn't attach ${String(failedImageCount)} images.`;
      const markdown = [
        stripBrowserImageMarkdownReferences(artifactDelivery.markdown),
        failureMessage,
      ]
        .filter(Boolean)
        .join("\n\n");
      await postLinqReply(
        context.thread,
        markdown,
        delivery.files,
        artifactDelivery.attachments
      );
    },
  },
  async onMessage(_context, message) {
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
        ? { ...auth.attributes, phoneNumber, workspaceId: scope.workspaceId }
        : { ...auth.attributes, workspaceId: scope.workspaceId };
    return {
      auth: {
        ...auth,
        attributes,
        principalId,
      },
    };
  },
} satisfies LinqChannelConfig;

export default linqChannel(linqChannelConfig);

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

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import {
  linqChannel,
  type defaultLinqAuth,
  type LinqChannelConfig,
  type LinqChannelCredentials,
  type LinqInboundResult,
} from "eve/channels/linq";
import { z } from "zod";
import { getAuth } from "@/auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { accessScopeForUser, scopeFromPrincipal } from "@/lib/access-scope";
import {
  verifyScopeAccess,
  WorkspaceNotOperableError,
} from "@/db/services/scope";
import {
  BudgetExceededError,
  checkBudget,
  recordUsageEvent,
} from "@/db/services/usage";
import {
  createConversationBinding,
  resolveConversationBinding,
} from "@/db/services/channel-conversations";
import { recordConnectionInstallation } from "@/db/services/connection-installations";
import { findVerifiedUserByPhoneNumber } from "@/db/services/phone-identities";
import {
  extractBrowserImageMarkdownReferences,
  stripBrowserImageMarkdownReferences,
} from "@/lib/browser-images";
import { env, isWorkspaceScopeEnforcementEnabled } from "@/lib/env";
import { consumeWorkerCancellationTurn } from "../lib/worker-cancellation-delivery";
import { prepareLinqBrowserImageDelivery } from "../lib/linq-browser-image-delivery";

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

export const linqChannelDependencies = {
  checkBudget,
  createConversationBinding,
  findVerifiedAuthUserIdByPhoneNumber,
  findVerifiedUserByPhoneNumber,
  getAuth,
  isWorkspaceScopeEnforcementEnabled,
  recordConnectionInstallation,
  recordUsageEvent,
  resolveConversationBinding,
  verifyScopeAccess,
  linqConfiguration() {
    return {
      connector: env.LINQ_CONNECTOR,
      phoneNumber: env.LINQ_PHONE_NUMBER,
    };
  },
};

const linqInboundContextSchema = z.object({
  thread: z.object({ id: z.string() }).optional(),
});
const linqInboundMessageSchema = z.object({
  author: z.object({
    isBot: z.boolean(),
    userId: z.string(),
    userName: z.string().optional(),
  }),
});

export type LinqInboundContext = z.infer<typeof linqInboundContextSchema>;
export type LinqInboundMessage = z.infer<typeof linqInboundMessageSchema>;
type LinqInboundAttributes = Record<string, readonly string[] | string>;

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
  thread: NonNullable<
    Parameters<
      NonNullable<NonNullable<LinqChannelConfig["events"]>["message.completed"]>
    >[1]["thread"]
  >,
  markdown: string,
  files: readonly unknown[] = [],
  scope?: ReturnType<typeof scopeFromPrincipal>
) {
  if (scope) {
    try {
      await linqChannelDependencies.checkBudget(scope, "provider_message");
    } catch (error) {
      if (
        error instanceof BudgetExceededError ||
        error instanceof WorkspaceNotOperableError
      ) {
        await thread.post({ markdown: error.message });
        recordLinqUsage(scope);
      }
      throw error;
    }
  }
  const bubbles = splitLinqReply(markdown);
  if (bubbles.length === 0) {
    if (files.length > 0) await thread.post({ files, markdown: "" });
    if (files.length > 0) recordLinqUsage(scope);
    return;
  }
  for (const [index, bubble] of bubbles.entries()) {
    if (index === bubbles.length - 1 && files.length > 0) {
      await thread.post({ files, markdown: bubble });
    } else {
      await thread.post({ markdown: bubble });
    }
  }
  recordLinqUsage(scope);
}

function recordLinqUsage(
  scope: ReturnType<typeof scopeFromPrincipal> | undefined
) {
  if (!scope) return;
  void linqChannelDependencies
    .recordUsageEvent(scope, {
      kind: "provider_message",
      quantity: 1,
      unit: "messages",
    })
    .catch(() => {
      console.warn("[usage] usage event recording failed");
    });
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
        if (context.thread) {
          const messageId = context.thread.toJSON().currentMessage?.id;
          if (
            messageId &&
            context.state.acknowledgedLinqMessageId !== messageId
          ) {
            try {
              await context.bot
                .getAdapter("linq")
                .addReaction(context.thread.id, messageId, "thumbs_up");
              context.state.acknowledgedLinqMessageId = messageId;
            } catch {
              // SMS/RCS and some carrier paths do not support iMessage tapbacks.
            }
          }
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
        // Provider-auth-only replies lack a workspace and are not budgeted or ledgered.
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
      const delivery = await prepareLinqBrowserImageDelivery(event.message, {
        rootSessionId: session.session.id,
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
      const markdown = [delivery.markdown, failureMessage]
        .filter(Boolean)
        .join("\n\n");
      try {
        await postLinqReply(
          context.thread,
          markdown,
          delivery.files,
          scopeFromPrincipal(caller)
        );
      } catch (error) {
        if (
          error instanceof BudgetExceededError ||
          error instanceof WorkspaceNotOperableError
        )
          return;
        throw error;
      }
    },
  },
  onMessage(context, message) {
    const inboundContext = linqInboundContextSchema.safeParse(context);
    const inboundMessage = linqInboundMessageSchema.safeParse(message);
    if (!inboundContext.success || !inboundMessage.success) return null;
    return createLinqOnMessage()(inboundContext.data, inboundMessage.data);
  },
} satisfies LinqChannelConfig;

export function createLinqOnMessage() {
  return async function onMessage(
    context: LinqInboundContext,
    message: LinqInboundMessage
  ): Promise<LinqInboundResult> {
    if (message.author.isBot) return null;

    const auth = defaultInboundLinqAuth(message);
    const authorUserName = z.string().safeParse(message.author.userName);
    const phoneNumber = authorUserName.success
      ? normalizeAuthPhoneNumber(authorUserName.data)
      : undefined;
    const verifiedUserId = phoneNumber
      ? await linqChannelDependencies.findVerifiedAuthUserIdByPhoneNumber(
          phoneNumber
        )
      : undefined;
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);
    const attributes =
      verifiedUserId && phoneNumber
        ? { ...auth.attributes, phoneNumber, workspaceId: scope.workspaceId }
        : { ...auth.attributes, workspaceId: scope.workspaceId };
    if (!linqChannelDependencies.isWorkspaceScopeEnforcementEnabled()) {
      return {
        auth: {
          ...auth,
          attributes,
          principalId,
        },
      };
    }
    if (!(await linqChannelDependencies.verifyScopeAccess(scope))) {
      return null;
    }

    if (verifiedUserId && phoneNumber) {
      const identity =
        await linqChannelDependencies.findVerifiedUserByPhoneNumber(
          phoneNumber
        );
      if (identity?.userId === verifiedUserId) {
        const provider = "linq";
        const { connector: providerAccountId, phoneNumber: providerLineId } =
          linqChannelDependencies.linqConfiguration();
        const providerConversationId = context.thread?.id;
        if (providerAccountId && providerLineId && providerConversationId) {
          let binding =
            await linqChannelDependencies.resolveConversationBinding({
              provider,
              providerAccountId,
              providerConversationId,
            });
          let bindingCreated = false;
          if (!binding) {
            binding = await linqChannelDependencies.createConversationBinding({
              phoneIdentityId: identity.phoneIdentityId,
              platformLine: {
                connectorId: providerAccountId,
                providerLineId,
              },
              provider,
              providerAccountId,
              providerConversationId,
              userId: verifiedUserId,
            });
            bindingCreated = binding !== undefined;
          }
          if (binding && binding.workspaceId !== scope.workspaceId) return null;
          if (binding && bindingCreated) {
            try {
              await linqChannelDependencies.recordConnectionInstallation(
                scope,
                {
                  authorizationSubject: providerLineId,
                  connectorId: providerAccountId,
                  provider: "linq",
                }
              );
            } catch {
              console.warn("[linq] connection installation recording failed");
            }
          }
          // MVP transition rule: until real workspaces have active agents,
          // preserve the existing channel behavior rather than dropping turns.
        }
      }
    }
    return {
      auth: {
        ...auth,
        attributes,
        principalId,
      },
    };
  };
}

export default linqChannel(linqChannelConfig);

function defaultInboundLinqAuth(
  message: LinqInboundMessage
): ReturnType<typeof defaultLinqAuth> {
  const attributes: LinqInboundAttributes = {};
  if (message.author.userName !== undefined) {
    attributes.user_name = message.author.userName;
  }
  return {
    attributes,
    authenticator: "linq-message",
    issuer: "linq",
    principalId: `linq:${message.author.userId}`,
    principalType: message.author.isBot ? "service" : "user",
    subject: message.author.userId,
  };
}

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const auth = await linqChannelDependencies.getAuth();
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}

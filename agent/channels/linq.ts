/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import {
  defaultLinqAuth,
  linqChannel,
  type LinqChannelCredentials,
  type LinqChannelConfig,
} from "eve/channels/linq";
import { z } from "zod";
import { auth } from "@/auth";
import { normalizeAuthPhoneNumber } from "@/auth/phone-number";
import { accessScopeForUser } from "@/lib/access-scope";
import { env } from "@/lib/env";
import { linqReactionRequestSchema } from "@/agent/lib/linq-reactions";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});

const credentials: LinqChannelCredentials = env.LINQ_CONNECTOR
  ? connectLinqCredentials(env.LINQ_CONNECTOR)
  : {
      apiKey() {
        throw new Error(
          "LINQ_CONNECTOR is not configured for this deployment."
        );
      },
    };

type LinqMessageCompletedHandler = NonNullable<
  NonNullable<LinqChannelConfig["events"]>["message.completed"]
>;
type LinqActionResultHandler = NonNullable<
  NonNullable<LinqChannelConfig["events"]>["action.result"]
>;

export const deliverLinqReaction: LinqActionResultHandler = async (
  event,
  context
) => {
  if (
    event.status !== "completed" ||
    event.result.kind !== "tool-result" ||
    event.result.toolName !== "react_to_message" ||
    !context.thread
  ) {
    return;
  }

  const request = linqReactionRequestSchema.safeParse(event.result.output);
  const messageId = context.thread.toJSON().currentMessage?.id;
  if (!request.success || !messageId) return;

  await context.bot
    .getAdapter("linq")
    .addReaction(context.thread.id, messageId, request.data.reaction);
};

export const deliverCompletedLinqMessage: LinqMessageCompletedHandler = async (
  event,
  context
) => {
  if (event.finishReason === "tool-calls") {
    context.state.pendingToolCallMessage = event.message
      ? (firstNonEmptyLine(event.message) ?? null)
      : null;
    return;
  }

  context.state.pendingToolCallMessage = null;
  if (!event.message || !context.thread) return;

  // Eve's Linq adapter translates supported Markdown into native iMessage
  // decorations, so recipients see styled text instead of literal markers.
  await context.thread.post({ markdown: event.message });
};

export default linqChannel({
  credentials,
  events: {
    "action.result": deliverLinqReaction,
    "message.completed": deliverCompletedLinqMessage,
  },
  async onMessage(_context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName: unknown = message.author.userName;
    const phoneNumber =
      typeof authorUserName === "string"
        ? normalizeAuthPhoneNumber(authorUserName)
        : undefined;
    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

function firstNonEmptyLine(message: string) {
  return message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

async function findVerifiedAuthUserIdByPhoneNumber(phoneNumber: string) {
  const context = await auth.$context;
  const user = await context.adapter.findOne({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  const parsed = verifiedPhoneUserSchema.safeParse(user);
  return parsed.success ? parsed.data.id : undefined;
}

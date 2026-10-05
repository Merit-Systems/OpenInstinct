import type { LinqAPIV3 } from "@linqapp/sdk";
import type { Message, Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { defaultLinqAuth } from "eve/channels/linq";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { z } from "zod";
import { getAuth } from "@db/services/auth";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { linqMessageContent } from "@agent/lib/linq/content";
import { linqAdapter, sendNativeLinqMessage } from "@agent/lib/linq/transport";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@agent/lib/schedules/report-lifecycle";

const verifiedPhoneUserSchema = z.object({
  id: z.string().min(1),
  phoneNumberVerified: z.literal(true),
});
type LinqMessageContent = Parameters<
  LinqAPIV3["chats"]["messages"]["send"]
>[1]["message"];

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

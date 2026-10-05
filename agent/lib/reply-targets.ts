import { defineState, type SessionAuth } from "eve/context";
import { z } from "zod";
import { scheduledReportIdentity } from "@agent/lib/schedules/identity";
import type { ReplyReference } from "@shared/chat/message-delivery";

const imessageReplyTargetSchema = z.strictObject({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});

type ImessageReplyTarget = z.infer<typeof imessageReplyTargetSchema>;

const backgroundReplyTargets = defineState<Record<string, ImessageReplyTarget>>(
  "open-instinct.background-reply-targets",
  () => ({})
);

const maximumBackgroundReplyTargets = 100;

export function registerBackgroundReplyTarget(
  taskId: string,
  auth: SessionAuth
) {
  const target = currentLinqReplyTarget(auth) ?? currentBlooioReplyTarget(auth);
  if (!target) return;

  backgroundReplyTargets.update((current) =>
    Object.fromEntries(
      [
        ...Object.entries(current).filter(([id]) => id !== taskId),
        [taskId, target] as const,
      ].slice(-maximumBackgroundReplyTargets)
    )
  );
}

export function resolveLinqReplyTarget(
  reference: ReplyReference | undefined,
  auth: SessionAuth
) {
  return resolveImessageReplyTarget(reference, auth, "linq");
}

export function resolveBlooioReplyTarget(
  reference: ReplyReference | undefined,
  auth: SessionAuth
) {
  return resolveImessageReplyTarget(reference, auth, "blooio");
}

function resolveImessageReplyTarget(
  reference: ReplyReference | undefined,
  auth: SessionAuth,
  channel: "blooio" | "linq"
) {
  if (!reference) return undefined;

  const conversationId = currentConversationId(auth, channel);
  if (!conversationId) return undefined;

  if (reference.kind === "current") {
    return channel === "linq"
      ? currentLinqReplyTarget(auth)
      : currentBlooioReplyTarget(auth);
  }

  if (reference.kind === "task") {
    const target = backgroundReplyTargets.get()[reference.id];
    return target?.conversationId === conversationId ? target : undefined;
  }

  const report = scheduledReportIdentity(auth);
  if (report?.scheduleId !== reference.id || !report.replyAnchorMessageId) {
    return undefined;
  }
  return {
    conversationId,
    messageId: report.replyAnchorMessageId,
  } satisfies ImessageReplyTarget;
}

function currentConversationId(auth: SessionAuth, channel: "blooio" | "linq") {
  const caller = auth.current ?? auth.initiator;
  if (caller?.attributes.conversationChannel !== channel) return undefined;
  const parsed = z
    .string()
    .startsWith(`${channel}:`)
    .safeParse(caller.attributes.conversationId);
  return parsed.success ? parsed.data : undefined;
}

function currentLinqReplyTarget(auth: SessionAuth) {
  return currentReplyTarget(auth, "linq", "linqMessageId");
}

function currentBlooioReplyTarget(auth: SessionAuth) {
  return currentReplyTarget(auth, "blooio", "blooioMessageId");
}

function currentReplyTarget(
  auth: SessionAuth,
  channel: "blooio" | "linq",
  messageAttribute: "blooioMessageId" | "linqMessageId"
) {
  const caller = auth.current;
  if (caller?.attributes.conversationChannel !== channel) return undefined;
  const parsed = imessageReplyTargetSchema.safeParse({
    conversationId: caller.attributes.conversationId,
    messageId: caller.attributes[messageAttribute],
  });
  if (
    !parsed.success ||
    !parsed.data.conversationId.startsWith(`${channel}:`)
  ) {
    return undefined;
  }
  return parsed.data;
}

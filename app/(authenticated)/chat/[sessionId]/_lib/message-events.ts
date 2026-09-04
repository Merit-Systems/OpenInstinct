import type { MessageStreamEvent } from "eve/client";
import type { EveMessagePart } from "eve/react";
import {
  reactionTextFor,
  reactToMessageToolResultSchema,
} from "@shared/chat/reaction";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";

export function messageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    if (event.type === "message.received") {
      timestamps.set(`${event.data.turnId}:user`, event.meta.at);
    }

    if (
      event.type === "message.completed" &&
      event.data.finishReason !== "tool-calls"
    ) {
      timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
    }
  }

  return timestamps;
}

export function imessageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    if (event.type === "message.received") {
      timestamps.set(`${event.data.turnId}:user`, event.meta.at);
    }
  }

  return timestamps;
}

export function sentMessages(events: readonly MessageStreamEvent[]) {
  const messagesByTurn = new Map<
    string,
    { id: string; parts: EveMessagePart[]; timestamp: string }[]
  >();

  for (const event of events) {
    if (event.type !== "action.result") continue;
    const delivery = completedSendMessageOutput(event);
    const reaction = completedReactionOutput(event);
    const completed = delivery ?? reaction;
    if (!completed) continue;

    const turnMessageId = `${event.data.turnId}:assistant`;
    const parts: EveMessagePart[] = [];
    if (reaction) {
      parts.push({
        state: "done",
        stepIndex: event.data.stepIndex,
        text: reactionTextFor(reaction.output.type),
        type: "text",
      });
    } else if (delivery) {
      const { output } = delivery;
      // Delivered text is plain and reaches the user verbatim. The chat view
      // renders text parts as Markdown, so keep every line break as a hard break.
      const text =
        output.kind === "link"
          ? output.url
          : output.text?.replaceAll("\n", "  \n");
      if (text) {
        parts.push({
          state: "done",
          stepIndex: event.data.stepIndex,
          text,
          type: "text",
        });
      }
      const attachments = output.kind === "message" ? output.attachments : [];
      for (const attachment of attachments ?? []) {
        parts.push({
          filename: attachment.name,
          mediaType: attachment.mimeType ?? defaultMediaType[attachment.kind],
          stepIndex: event.data.stepIndex,
          type: "file",
          url: attachment.url,
        });
      }
    }
    const messages = messagesByTurn.get(turnMessageId) ?? [];
    messages.push({
      id: `${turnMessageId}:${completed.callId}`,
      parts,
      timestamp: event.meta.at,
    });
    messagesByTurn.set(turnMessageId, messages);
  }

  return messagesByTurn;
}

function completedReactionOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = reactToMessageToolResultSchema.safeParse(event.data.result);
  return result.success && result.data.output.operation === "add"
    ? { callId: event.data.result.callId, output: result.data.output }
    : undefined;
}

function completedSendMessageOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = sendMessageToolResultSchema.safeParse(event.data.result);
  return result.success
    ? { callId: event.data.result.callId, output: result.data.output }
    : undefined;
}

const defaultMediaType = {
  audio: "audio/*",
  file: "application/octet-stream",
  image: "image/*",
  video: "video/*",
} as const;

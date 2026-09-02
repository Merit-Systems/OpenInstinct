import type { MessageStreamEvent } from "eve/client";
import type { EveMessagePart } from "eve/react";
import { sendMessageToolResultSchema } from "@/agent/lib/send-message";

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
    if (!delivery) continue;

    const turnMessageId = `${event.data.turnId}:assistant`;
    const parts: EveMessagePart[] = [];
    const { output } = delivery;
    const text = output.kind === "link" ? output.url : output.markdown;
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
    const messages = messagesByTurn.get(turnMessageId) ?? [];
    messages.push({
      id: `${turnMessageId}:${delivery.callId}`,
      parts,
      timestamp: event.meta.at,
    });
    messagesByTurn.set(turnMessageId, messages);
  }

  return messagesByTurn;
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

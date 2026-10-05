import { defaultMessageReducer, type MessageStreamEvent } from "eve/client";
import type { EveMessage, EveMessagePart } from "eve/react";
import { parseMessageContext } from "@shared/chat/message-context";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import {
  backgroundWorkerDeliveryMessageIds,
  type TraceView,
} from "./trace-view";

export interface ConversationRow extends EveMessage {
  timestamp?: string;
  reactions?: readonly string[];
  reply?: {
    text: string;
    targetId?: string;
    image?: Extract<EveMessagePart, { type: "file" }>;
  };
}

const reducer = defaultMessageReducer();

export function conversationRows(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  view: TraceView
) {
  if (view === "trace") {
    const timestamps = new Map<string, string>();
    for (const event of events) {
      if (event.type === "message.received") {
        timestamps.set(`${event.meta.id}:user`, event.meta.at);
        timestamps.set(`${event.data.turnId}:user`, event.meta.at);
      } else if (
        event.type === "message.completed" &&
        event.data.finishReason !== "tool-calls"
      )
        timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
    }
    const rows: ConversationRow[] = [];
    for (const message of messages)
      rows.push({ ...message, timestamp: timestamps.get(message.id) });
    return rows;
  }

  const rows: ConversationRow[] = [];
  const references = new Map<
    string,
    { row: ConversationRow; context: ReturnType<typeof readContext> }
  >();
  const turns = new Map<string, ConversationRow>();
  const hidden = backgroundWorkerDeliveryMessageIds(events);
  for (const event of events) {
    if (event.type === "message.received") {
      // Let Eve own receipt IDs and structured input projection.
      const message = reducer.reduce(reducer.initial(), event).messages[0];
      if (
        !message ||
        hidden.has(message.id) ||
        hidden.has(`${event.data.turnId}:user`)
      )
        continue;
      const context = readContext(message.parts);
      const row: ConversationRow = {
        ...message,
        parts: context ? message.parts.slice(1) : message.parts,
        reactions: [],
        timestamp: event.meta.at,
      };
      if (context?.replyTo)
        row.reply = replyPreview(
          references.get(context.replyTo.messageId),
          context.replyTo.partIndex
        );
      rows.push(row);
      const reference = { row, context };
      references.set(row.id, reference);
      if (context) references.set(context.messageId, reference);
      // Historical browser tools supplied a turn alias instead of a receipt ID.
      references.set(`${event.data.turnId}:user`, reference);
      turns.set(event.data.turnId, row);
      continue;
    }
    if (
      event.type !== "action.result" ||
      event.data.status !== "completed" ||
      hidden.has(`${event.data.turnId}:assistant`)
    )
      continue;
    const reaction = reactToMessageToolResultSchema.safeParse(
      event.data.result
    );
    if (reaction.success) {
      const { output } = reaction.data;
      const target =
        "messageId" in output
          ? references.get(output.messageId)?.row
          : turns.get(event.data.turnId);
      // An unloaded target never falls back to an unrelated message.
      if (target) {
        const remaining =
          target.reactions?.filter((emoji) => emoji !== output.emoji) ?? [];
        target.reactions =
          output.operation === "add" ? [...remaining, output.emoji] : remaining;
      }
      continue;
    }
    const delivery = sendMessageToolResultSchema.safeParse(event.data.result);
    if (!delivery.success) continue;
    const id = `tool:${event.data.result.callId}`;
    if (references.has(id)) continue;
    const row: ConversationRow = {
      id,
      role: "assistant",
      metadata: { turnId: event.data.turnId, status: "complete" },
      parts: deliveredParts(delivery.data.output),
      timestamp: event.meta.at,
    };
    rows.push(row);
    references.set(id, { row, context: undefined });
  }
  return rows;
}

function deliveredParts(
  output: ReturnType<typeof sendMessageToolResultSchema.parse>["output"]
) {
  const parts: EveMessagePart[] = [];
  const text =
    output.kind === "link" ? output.url : output.text?.replaceAll("\n", "  \n");
  if (text) parts.push({ type: "text", text, state: "done" });
  if (output.kind === "message")
    for (const attachment of output.attachments ?? [])
      parts.push({
        type: "file",
        filename: attachment.name,
        url: attachment.url,
        mediaType: attachment.mimeType ?? defaultMediaType[attachment.kind],
      });
  return parts;
}

function replyPreview(
  target:
    | { row: ConversationRow; context: ReturnType<typeof readContext> }
    | undefined,
  partIndex = 0
): NonNullable<ConversationRow["reply"]> {
  const part = target?.context?.parts?.find(
    (item) => item.partIndex === partIndex
  );
  const occurrence =
    target?.context?.parts?.filter(
      (item) =>
        item.partIndex < partIndex &&
        part?.url !== undefined &&
        item.url === part.url
    ).length ?? 0;
  const image = target?.row.parts.filter(
    (item): item is Extract<EveMessagePart, { type: "file" }> =>
      item.type === "file" &&
      part?.url !== undefined &&
      item.url === part.url &&
      item.mediaType.startsWith("image/")
  )[occurrence];
  const body = target?.row.parts.find((item) => item.type === "text");
  return {
    targetId: target?.row.id,
    image,
    text:
      image?.filename ??
      part?.value ??
      (body?.type === "text" ? body.text : "Earlier message"),
  };
}

function readContext(parts: readonly EveMessagePart[]) {
  const first = parts[0];
  if (first?.type !== "text" || parts.length < 2) return undefined;
  const body = parts.slice(1);
  if (
    !body.some(
      (part) =>
        part.type === "file" || (part.type === "text" && part.text.trim())
    )
  )
    return undefined;
  const context = parseMessageContext(first.text);
  if (!context) return undefined;
  // Attachment-only annotations must bind their references to the actual files.
  if (!body.some((part) => part.type === "text" && part.text.trim())) {
    const files = body.filter((part) => part.type === "file");
    if (
      !context.parts?.length ||
      !files.length ||
      !files.every(
        (file) =>
          file.url !== undefined &&
          context.parts?.some((part) => part.url === file.url)
      )
    )
      return undefined;
  }
  return context;
}

const defaultMediaType = {
  audio: "audio/*",
  file: "application/octet-stream",
  image: "image/*",
  video: "video/*",
} as const;

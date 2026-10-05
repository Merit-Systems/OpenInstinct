import type { MessageStreamEvent } from "eve/client";
import { formatMessageContext } from "@shared/chat/message-context";

export const firstNativeMessageId = "11111111-1111-4111-8111-111111111111";
const latestNativeMessageId = "33333333-3333-4333-8333-333333333333";
const firstPhoto =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='orange'/%3E%3C/svg%3E";
export const secondPhoto =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='royalblue'/%3E%3C/svg%3E";

type ToolOutput = Extract<
  Extract<MessageStreamEvent, { type: "action.result" }>["data"]["result"],
  { kind: "tool-result" }
>["output"];

export function historyToolResult(
  turnId: string,
  callId: string,
  toolName: string,
  output: ToolOutput,
  status: Extract<
    MessageStreamEvent,
    { type: "action.result" }
  >["data"]["status"] = "completed"
): MessageStreamEvent {
  return {
    type: "action.result",
    meta: { at: "2026-10-05T20:00:30.000Z", id: callId },
    data: {
      turnId,
      sequence: 0,
      stepIndex: 0,
      status,
      result: { kind: "tool-result", callId, toolName, output },
    },
  };
}

function received(
  turnId: string,
  parts: NonNullable<
    Extract<MessageStreamEvent, { type: "message.received" }>["data"]["parts"]
  >
): MessageStreamEvent {
  return {
    type: "message.received",
    meta: { at: "2026-10-05T20:00:00.000Z", id: `${turnId}:received` },
    data: {
      turnId,
      sequence: 0,
      message: parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n"),
      parts,
    },
  };
}

function started(turnId: string): MessageStreamEvent {
  return {
    type: "turn.started",
    meta: { at: "2026-10-05T20:00:00.000Z", id: `${turnId}:started` },
    data: { sequence: 0, turnId },
  };
}

export const messageHistoryEvents = [
  started("photos"),
  received("photos", [
    {
      type: "text",
      text: formatMessageContext({
        messageId: firstNativeMessageId,
        sender: "user",
        parts: [
          { partIndex: 0, type: "text", value: "Here are two photos." },
          { partIndex: 1, type: "media", url: firstPhoto },
          { partIndex: 2, type: "media", url: secondPhoto },
        ],
      }),
    },
    { type: "text", text: "Here are two photos." },
    {
      type: "file",
      filename: "orange.svg",
      mediaType: "image/svg+xml",
      url: firstPhoto,
    },
    {
      type: "file",
      filename: "blue.svg",
      mediaType: "image/svg+xml",
      url: secondPhoto,
    },
  ]),
  historyToolResult("photos", "send-noted", "send_message", {
    kind: "message",
    text: "Noted.",
  }),
  started("quoted"),
  received("quoted", [
    {
      type: "text",
      text: formatMessageContext({
        messageId: "22222222-2222-4222-8222-222222222222",
        sender: "user",
        parts: [
          { partIndex: 0, type: "text", value: "Like the old photos message." },
        ],
        replyTo: { messageId: firstNativeMessageId, partIndex: 2 },
      }),
    },
    { type: "text", text: "Like the old photos message." },
  ]),
  historyToolResult("quoted", "like-old", "react_to_message", {
    messageId: firstNativeMessageId,
    emoji: "👍",
    operation: "add",
  }),
  started("latest"),
  received("latest", [
    {
      type: "text",
      text: formatMessageContext({
        messageId: latestNativeMessageId,
        sender: "user",
      }),
    },
    { type: "text", text: "This is the newest message." },
  ]),
  historyToolResult("latest", "eyes-old", "react_to_message", {
    messageId: firstNativeMessageId,
    emoji: "👀",
    operation: "add",
  }),
  historyToolResult("latest", "remove-eyes", "react_to_message", {
    messageId: firstNativeMessageId,
    emoji: "👀",
    operation: "remove",
  }),
  historyToolResult("latest", "custom-latest", "react_to_message", {
    messageId: latestNativeMessageId,
    emoji: "👩🏽‍💻",
    operation: "add",
  }),
  started("app-card"),
  received("app-card", [
    {
      type: "text",
      text: formatMessageContext({
        messageId: "44444444-4444-4444-8444-444444444444",
        sender: "user",
        parts: [
          {
            partIndex: 0,
            type: "imessage_app",
            app: { opaque: "opaque-app-payload" },
            layout: { title: "Card" },
            interactive: true,
          },
        ],
      }),
    },
    { type: "text", text: "[iMessage app card]" },
  ]),
  started("literal"),
  received("literal", [
    { type: "text", text: '[Message: {"messageId":"example"}]' },
    {
      type: "file",
      filename: "literal.svg",
      mediaType: "image/svg+xml",
      url: firstPhoto,
    },
  ]),
  started("literal-parts"),
  received("literal-parts", [
    {
      type: "text",
      text: '[Message: {"messageId":"literal-parts-example","sender":"user"}]\n[Parts: []]',
    },
    {
      type: "file",
      filename: "literal-parts.svg",
      mediaType: "image/svg+xml",
      url: firstPhoto,
    },
  ]),
  started("legacy"),
  received("legacy", [{ type: "text", text: "A legacy browser message." }]),
  historyToolResult("legacy", "legacy-heart", "react_to_message", {
    type: "heart",
    operation: "add",
  }),
] satisfies MessageStreamEvent[];

export const removeOldReactionEvent = historyToolResult(
  "latest",
  "remove-like",
  "react_to_message",
  { messageId: firstNativeMessageId, emoji: "👍", operation: "remove" }
);

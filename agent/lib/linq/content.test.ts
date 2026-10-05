import { Message } from "chat";
import { describe, expect, it } from "vitest";
import { linqMessageContent } from "./content";

describe("Linq message content", () => {
  it("embeds indexed parts and the quoted target before the original text and media", () => {
    const message = received({
      parts: [
        { type: "text", value: "this one" },
        { type: "media", url: "https://media.example/photo.png" },
      ],
      reply_to: { message_id: "older-message", part_index: 1 },
    });
    message.attachments.push({
      type: "image",
      mimeType: "image/png",
      url: "https://media.example/photo.png",
    });
    expect(linqMessageContent(message)).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-2","sender":"user"}]\n[Parts: [{"partIndex":0,"type":"text","value":"this one"},{"partIndex":1,"type":"media","url":"https://media.example/photo.png"}]]\n[Reply to: {"messageId":"older-message","partIndex":1}]',
      },
      { type: "text", text: "this one" },
      expect.objectContaining({ type: "file", mediaType: "image/png" }),
    ]);
  });

  it("preserves opaque app-card state when the adapter supplies no text or attachments", () => {
    const raw = {
      parts: [
        {
          type: "imessage_app",
          url: "data:application/json;base64,e30=",
          app: { bundle_id: "example.game", name: "Game" },
          layout: { caption: "Your move" },
          fallback_text: "Game invite",
          interactive: true,
        },
      ],
    };
    const message = received(raw);
    message.text = "";
    const content = linqMessageContent(message);
    expect(content).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-2","sender":"user"}]\n[Parts: [{"partIndex":0,"type":"imessage_app","url":"data:application/json;base64,e30=","app":{"bundle_id":"example.game","name":"Game"},"layout":{"caption":"Your move"},"fallback_text":"Game invite","interactive":true}]]',
      },
      { type: "text", text: "[iMessage app card]" },
    ]);
    expect(message.raw).toBe(raw);
    expect(message.text).toBe("");
  });

  it("keeps original content when the raw metadata is malformed", () => {
    expect(linqMessageContent(received({ parts: "invalid" }))).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-2","sender":"user"}]',
      },
      { type: "text", text: "this one" },
    ]);
  });

  it("does not turn an empty incoming message into a metadata-only turn", () => {
    const message = received({ parts: [] });
    message.text = "";
    expect(linqMessageContent(message)).toEqual([]);
  });
});

function received(raw: Message["raw"]) {
  return new Message({
    id: "message-2",
    threadId: "linq:chat-1",
    raw,
    text: "this one",
    attachments: [],
    formatted: { type: "root", children: [] },
    author: {
      userId: "sender-1",
      userName: "+15550100011",
      fullName: "Sender",
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: new Date("2026-10-05T12:00:00Z"), edited: false },
  });
}

import { describe, expect, it } from "vitest";
import { formatMessageContext, parseMessageContext } from "./message-context";

describe("message annotations", () => {
  it("round trips indexed parts, reply index, and opaque app metadata", () => {
    const context = {
      messageId: "message-1",
      sender: "user" as const,
      parts: [
        {
          partIndex: 0,
          type: "imessage_app",
          app: { opaque: [1, "two"] },
          layout: { title: "Card" },
          fallback_text: null,
          interactive: true,
        },
      ],
      replyTo: { messageId: "older", partIndex: 2 },
    };
    expect(parseMessageContext(formatMessageContext(context))).toEqual(context);
  });

  it.each([
    '[Message: {"messageId":"example"}]',
    '[Message: {"messageId":"example","sender":"someone"}]',
    '[Message: {"messageId":"example","sender":"user"}]\nordinary prose',
    '[Message: {"messageId":"example","sender":"user"}]\n[Parts: [{"type":"text","partIndex":-1}]]',
    '[Message: {"messageId":"example","sender":"user"}]\n[Parts: []]\n[Parts: []]',
    "[Message: invalid-json]",
  ])("leaves unrecognized text unparsed: %s", (text) => {
    expect(parseMessageContext(text)).toBeUndefined();
  });
});

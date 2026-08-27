import { describe, expect, it } from "vitest";
import {
  claimConversationMessageRelay,
  conversationMessageFromActionResult,
  conversationMessageFromOutput,
} from "../lib/conversation-message";

describe("conversation messages", () => {
  it("reads sendMessage output for the web conversation", () => {
    expect(
      conversationMessageFromOutput("sendMessage", { message: "Hello." })
    ).toBe("Hello.");
    expect(
      conversationMessageFromOutput("anotherTool", { message: "Hidden." })
    ).toBeUndefined();
  });

  it("reads sendMessage action results for channel delivery", () => {
    expect(
      conversationMessageFromActionResult({
        kind: "tool-result",
        output: { message: "Done." },
        toolName: "sendMessage",
      })
    ).toBe("Done.");
    expect(
      conversationMessageFromActionResult({
        kind: "tool-result",
        output: { message: "Hidden." },
        toolName: "anotherTool",
      })
    ).toBeUndefined();
  });

  it("relays identical messages only once per turn", () => {
    const state = {};

    expect(claimConversationMessageRelay(state, "turn-1", "Hello.")).toBe(true);
    expect(claimConversationMessageRelay(state, "turn-1", "Hello.")).toBe(
      false
    );
    expect(claimConversationMessageRelay(state, "turn-1", "Update.")).toBe(
      true
    );
    expect(claimConversationMessageRelay(state, "turn-2", "Hello.")).toBe(true);
  });
});

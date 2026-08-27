import { describe, expect, it } from "vitest";
import {
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
});

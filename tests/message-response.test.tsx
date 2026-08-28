import { describe, expect, it } from "vitest";
import { MessageResponse } from "../components/ai-elements/message";

describe("message response rendering", () => {
  it("uses the synchronous renderer for settled text", () => {
    const response = MessageResponse({ children: "Current response" });

    expect(response.props).toMatchObject({
      children: "Current response",
      isAnimating: false,
      mode: "static",
    });
  });

  it("keeps incremental rendering while text is streaming", () => {
    const response = MessageResponse({
      children: "Partial response",
      isAnimating: true,
    });

    expect(response.props).toMatchObject({
      children: "Partial response",
      isAnimating: true,
      mode: "streaming",
    });
  });
});

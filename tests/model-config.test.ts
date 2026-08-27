import { describe, expect, it } from "vitest";
import {
  createDirectHaikuSelection,
  DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS,
} from "@/lib/model-config";

describe("direct Anthropic model selection", () => {
  it("provides Eve with explicit context-window metadata", () => {
    const model = { modelId: "claude-haiku-4-5" };

    expect(createDirectHaikuSelection(model)).toEqual({
      model,
      modelContextWindowTokens: DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS,
    });
    expect(DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS).toBe(200_000);
  });
});

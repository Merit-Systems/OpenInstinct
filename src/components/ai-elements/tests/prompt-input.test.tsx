import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

describe("prompt input", () => {
  it("preserves compact footer children through the Motion adapter", () => {
    const markup = renderToStaticMarkup(
      <PromptInput compact onSubmit={() => undefined}>
        <PromptInputFooter>
          <span>Composer tools</span>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    );

    expect(markup).toContain("Composer tools");
    expect(markup).toContain('aria-label="Submit"');
  });
});

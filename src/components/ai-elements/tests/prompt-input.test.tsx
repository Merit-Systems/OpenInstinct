import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";

describe("prompt input", () => {
  it("anchors the compact submit button without dropping footer children", () => {
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
    expect(markup).toContain("absolute");
    expect(markup).toContain("right-1.5");
    expect(markup).toContain("bottom-1.5");
  });

  it("leaves non-compact submit buttons in normal flow", () => {
    const markup = renderToStaticMarkup(<PromptInputSubmit />);

    expect(markup).toContain('aria-label="Submit"');
    expect(markup).not.toContain("absolute");
  });
});

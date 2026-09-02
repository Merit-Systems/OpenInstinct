import { describe, expect, it } from "vitest";
import { formatLinqMarkdown } from "./markdown";

const url =
  "https://assistant.example.com/vault?setup=vault&kind=payment&label=Card";

describe("formatLinqMarkdown", () => {
  it("keeps text after a URL off the link", () => {
    expect(formatLinqMarkdown(`${url}  \nTell me when it's saved.`)).toBe(
      `${url}\nTell me when it's saved.`
    );
    expect(formatLinqMarkdown(`${url}\n- Tell me when it's saved.`)).toBe(
      `${url}\n• Tell me when it's saved.`
    );
    expect(formatLinqMarkdown(`${url}\n\nTell me when it's saved.`)).toBe(
      `${url}\nTell me when it's saved.`
    );
  });

  it("rewrites links so the destination survives flattening", () => {
    expect(formatLinqMarkdown(`Open [your vault](${url}) to add it.`)).toBe(
      `Open your vault: ${url} to add it.`
    );
    expect(formatLinqMarkdown(`[${url}](${url})`)).toBe(url);
    expect(formatLinqMarkdown(`<${url}>`)).toBe(url);
  });

  it("turns block structure into plain lines", () => {
    expect(
      formatLinqMarkdown(
        "## Options\n\n- first\n- second\n\n1. do this\n2) then that\n\n> quoted\n\n---\n\n```\ncode\n```"
      )
    ).toBe(
      "**Options**\n• first\n• second\n1\\. do this\n2\\) then that\nquoted\ncode"
    );
  });

  it("leaves inline emphasis and image references alone", () => {
    expect(
      formatLinqMarkdown("**done** ![shot](/artifacts/abc)\n_next_ step")
    ).toBe("**done** ![shot](/artifacts/abc)\n_next_ step");
  });
});

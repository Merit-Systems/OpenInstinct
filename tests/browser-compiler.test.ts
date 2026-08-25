import { describe, expect, it } from "vitest";

import {
  compiledBrowserRequestSchema,
  compileUrlTemplate,
  inferJsonShape,
  renderCompiledUrl,
  validateJsonShape,
} from "../agent/browser-compiler/compiler";

function compiledRequest(urlTemplate: string) {
  return compiledBrowserRequestSchema.parse({
    name: "search_places",
    method: "GET",
    urlTemplate,
    parameters: [{ name: "query", example: "New York" }],
    expected: {
      status: 200,
      shape: {
        kind: "array",
        keys: [],
        itemKind: "object",
        itemKeys: ["id", "name"],
      },
    },
    sourceHost: "example.com",
    createdAt: "2026-08-25T12:00:00.000Z",
  });
}

describe("browser request compiler", () => {
  it("turns an observed encoded value into a named parameter", () => {
    expect(
      compileUrlTemplate(
        "https://example.com/api/search?q=New%20York&limit=10",
        [{ name: "query", example: "New York" }]
      )
    ).toBe("https://example.com/api/search?q={{query}}&limit=10");
  });

  it("replays a template with URL-encoded parameters", () => {
    expect(
      renderCompiledUrl(
        compiledRequest("https://example.com/api/search?q={{query}}"),
        {
          query: "São Paulo & coffee",
        }
      )
    ).toBe("https://example.com/api/search?q=S%C3%A3o%20Paulo%20%26%20coffee");
  });

  it("requires unique parameters whose examples occur in the trace", () => {
    expect(() =>
      compileUrlTemplate("https://example.com/api/search?q=Boston", [
        { name: "query", example: "Boston" },
        { name: "query", example: "Boston" },
      ])
    ).toThrow("unique name");
    expect(() =>
      compileUrlTemplate("https://example.com/api/search?q=Boston", [
        { name: "query", example: "Chicago" },
      ])
    ).toThrow("does not occur");
  });

  it("rejects missing or unexpected replay parameters", () => {
    const compiled = compiledRequest(
      "https://example.com/api/search?q={{query}}"
    );
    expect(() => renderCompiledUrl(compiled, {})).toThrow(
      "Missing required parameter"
    );
    expect(() =>
      renderCompiledUrl(compiled, { query: "Boston", extra: "unsafe" })
    ).toThrow("Unexpected parameters");
  });

  it("infers and validates a lightweight JSON response contract", () => {
    const shape = inferJsonShape('[{"id":1,"name":"Boston"}]');
    expect(shape).toEqual({
      kind: "array",
      keys: [],
      itemKind: "object",
      itemKeys: ["id", "name"],
    });
    expect(validateJsonShape([{ id: 2, name: "Chicago" }], shape!)).toEqual([]);
    expect(validateJsonShape([{ id: 2 }], shape!)).toEqual([
      'Missing array item key "name".',
    ]);
  });
});

import { describe, expect, it } from "vitest";
import parallel from "../agent/connections/parallel";

describe("Parallel public web connection", () => {
  it("uses the free MCP endpoint", () => {
    expect(parallel.url).toBe("https://search.parallel.ai/mcp");
  });

  it("exposes only public search and page extraction", () => {
    expect(parallel.tools).toEqual({
      allow: ["web_search", "web_fetch"],
    });
  });

  it("does not attach credentials or session-derived arguments", () => {
    expect(parallel.auth).toBeUndefined();
    expect(parallel.headers).toBeUndefined();
    expect(parallel.toolCall).toBeUndefined();
  });

  it("describes the public-only data boundary during discovery", () => {
    expect(parallel.description).toContain("Send only public information");
  });
});

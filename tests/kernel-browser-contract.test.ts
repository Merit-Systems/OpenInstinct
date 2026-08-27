import { describe, expect, it } from "vitest";
import { computerActionInputSchema } from "../agent/extensions/kernel/browser-contract";

describe("Kernel browser action latency bounds", () => {
  it("allows a two-second bounded sleep", () => {
    expect(
      computerActionInputSchema.safeParse({
        actions: [{ sleep: { duration_ms: 2_000 }, type: "sleep" }],
        session_id: "browser-session",
      }).success
    ).toBe(true);
  });

  it("rejects an unbounded multi-second sleep", () => {
    expect(
      computerActionInputSchema.safeParse({
        actions: [{ sleep: { duration_ms: 2_001 }, type: "sleep" }],
        session_id: "browser-session",
      }).success
    ).toBe(false);
  });

  it("rejects excessive per-character typing delay", () => {
    expect(
      computerActionInputSchema.safeParse({
        actions: [
          { type: "type_text", type_text: { delay: 251, text: "checkout" } },
        ],
        session_id: "browser-session",
      }).success
    ).toBe(false);
  });
});

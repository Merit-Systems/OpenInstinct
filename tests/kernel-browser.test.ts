import { describe, expect, it } from "vitest";
import {
  browserCloseInputSchema,
  browserRunInputSchema,
} from "../agent/lib/kernel-browser";

describe("Kernel browser tool input", () => {
  it("applies safe execution defaults", () => {
    expect(
      browserRunInputSchema.parse({ code: "return await page.title();" })
    ).toEqual({
      code: "return await page.title();",
      stealth: false,
      timeoutSeconds: 60,
    });
  });

  it("rejects empty session IDs and excessive execution time", () => {
    expect(
      browserRunInputSchema.safeParse({
        code: "return true;",
        sessionId: "",
        timeoutSeconds: 301,
      }).success
    ).toBe(false);
    expect(browserCloseInputSchema.safeParse({ sessionId: "" }).success).toBe(
      false
    );
  });
});

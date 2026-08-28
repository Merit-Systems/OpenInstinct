import { describe, expect, it } from "vitest";
import {
  browserLiveViewInputSchema,
  browserTimeoutFloorSeconds,
  manageBrowsersInputSchema,
} from "../agent/extensions/kernel/browser-contract";

describe("Kernel browser contract", () => {
  it("keeps agent-created browsers alive for at least 15 minutes", () => {
    expect(
      manageBrowsersInputSchema.safeParse({
        action: "create",
        timeout_seconds: 120,
      }).success
    ).toBe(false);
    expect(
      manageBrowsersInputSchema.safeParse({
        action: "create",
        timeout_seconds: browserTimeoutFloorSeconds,
      }).success
    ).toBe(true);
  });

  it("requires an explicit browser session for live-view access", () => {
    expect(browserLiveViewInputSchema.safeParse({}).success).toBe(false);
    expect(
      browserLiveViewInputSchema.safeParse({ session_id: "browser-1" }).success
    ).toBe(true);
  });
});

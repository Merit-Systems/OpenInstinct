import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalBrowserAvailable } from "../lib/browser-config";
import { localBrowserActionSchema } from "../lib/local-browser";

afterEach(() => vi.unstubAllEnvs());

describe("browser execution settings", () => {
  it("never exposes the local browser inside a cloud runtime", () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    expect(isLocalBrowserAvailable()).toBe(false);
  });

  it("accepts only web URLs for local navigation", () => {
    expect(
      localBrowserActionSchema.safeParse({
        action: "open",
        url: "https://example.com",
      }).success
    ).toBe(true);
    expect(
      localBrowserActionSchema.safeParse({
        action: "open",
        url: "file:///Users/example/.ssh/id_ed25519",
      }).success
    ).toBe(false);
  });
});

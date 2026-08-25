import { describe, expect, it } from "vitest";
import { kernelToolAllowlist } from "../agent/extensions/kernel/connections/browser";

describe("Kernel Eve extension", () => {
  it("exposes the complete Kernel MCP toolset", () => {
    expect(kernelToolAllowlist).toEqual([
      "manage_browsers",
      "execute_playwright_code",
      "computer_action",
      "browser_curl",
      "manage_auth_connections",
      "manage_credentials",
      "manage_profiles",
      "manage_proxies",
      "manage_replays",
      "manage_browser_pools",
      "exec_command",
    ]);
  });
});

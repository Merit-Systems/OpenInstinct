import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKernelSystemToken,
  kernelToolAllowlist,
} from "../agent/extensions/kernel/connections/browser";

afterEach(() => vi.unstubAllEnvs());

describe("Kernel Eve extension", () => {
  it("exposes the complete Kernel MCP toolset", () => {
    expect(kernelToolAllowlist).toEqual([
      "manage_browsers",
      "execute_playwright_code",
      "computer_action",
      "browser_curl",
      "manage_auth_connections",
      "manage_profiles",
      "manage_proxies",
      "manage_replays",
      "manage_browser_pools",
      "exec_command",
    ]);
  });

  it("uses the system Kernel key independently of browser mode", () => {
    vi.stubEnv("KERNEL_API_KEY", "system-kernel-key");
    expect(getKernelSystemToken()).toBe("system-kernel-key");
  });
});

import { defineMcpClientConnection } from "eve/connections";
import { getBrowserSettings } from "../../../../lib/browser-config.js";
import { getEnv } from "../../../../lib/runtime-env.js";

export const kernelToolAllowlist = [
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
];

export default defineMcpClientConnection({
  url: "https://mcp.onkernel.com/mcp",
  description:
    "Kernel cloud browser with the complete browser, authentication, networking, observability, pool, and VM execution toolset.",
  auth: {
    getToken: async () => {
      if ((await getBrowserSettings()).mode !== "cloud") {
        throw new Error(
          "The local browser is selected. Use the local_browser tool instead."
        );
      }
      const token = getEnv().KERNEL_API_KEY;

      if (!token) {
        throw new Error(
          "Cloud browser execution requires KERNEL_API_KEY in the system environment."
        );
      }

      return { token };
    },
  },
  tools: { allow: kernelToolAllowlist },
});

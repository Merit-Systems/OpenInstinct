import { defineMcpClientConnection } from "eve/connections";
import { getEnv } from "../../../../env.js";

export const kernelToolAllowlist = [
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
];

export default defineMcpClientConnection({
  url: "https://mcp.onkernel.com/mcp",
  description:
    "Kernel cloud browser with the complete browser, authentication, networking, observability, pool, and VM execution toolset.",
  auth: {
    getToken: async () => ({ token: getEnv().KERNEL_API_KEY }),
  },
  tools: { allow: kernelToolAllowlist },
});

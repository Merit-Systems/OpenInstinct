import { defineMcpClientConnection } from "eve/connections";
import { getEnv } from "../../../../lib/runtime-env.js";
import { readConnectionSecret } from "../../../../lib/server/manager-store.js";
import { scopeFromPrincipal } from "../../../../lib/access-scope.js";

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
    getToken: async ({ principal }) => {
      if (principal.type !== "user") {
        throw new Error("An authenticated workspace user is required.");
      }
      const scope = scopeFromPrincipal(principal);
      const token =
        (await readConnectionSecret(scope, "kernel").catch(() => undefined)) ??
        (scope.mode === "local" ? getEnv().KERNEL_API_KEY : undefined);

      if (!token) {
        throw new Error(
          "Kernel is not connected. Add a Kernel API key in the local manager."
        );
      }

      return { token };
    },
  },
  tools: { allow: kernelToolAllowlist },
});

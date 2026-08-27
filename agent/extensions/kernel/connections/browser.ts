import { defineMcpClientConnection } from "eve/connections";
import { getEnv } from "../../../../lib/runtime-env.js";

export const kernelToolAllowlist: string[] = [];

export function getKernelSystemToken() {
  const token = getEnv().KERNEL_API_KEY;
  if (!token) {
    throw new Error("The browser runtime is unavailable.");
  }
  return token;
}

export default defineMcpClientConnection({
  url: "https://mcp.onkernel.com/mcp",
  description: "Reserved browser integration.",
  auth: {
    getToken: async ({ principal }) => {
      if (principal.type !== "user") {
        throw new Error("An authenticated workspace user is required.");
      }
      return { token: getKernelSystemToken() };
    },
  },
  tools: { allow: kernelToolAllowlist },
});

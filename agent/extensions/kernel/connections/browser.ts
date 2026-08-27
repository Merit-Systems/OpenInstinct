import { defineMcpClientConnection } from "eve/connections";
import { env } from "@/lib/env";

export const kernelToolAllowlist: string[] = [];

export default defineMcpClientConnection({
  url: "https://mcp.onkernel.com/mcp",
  description: "Reserved browser integration.",
  auth: {
    getToken: async ({ principal }) => {
      if (principal.type !== "user") {
        throw new Error("An authenticated workspace user is required.");
      }
      return { token: env.KERNEL_API_KEY };
    },
  },
  tools: { allow: kernelToolAllowlist },
});

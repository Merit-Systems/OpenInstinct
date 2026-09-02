import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";
import { safeAgentcashReadInput } from "../lib/agentcash-policy";

const inputSchema = z.object({
  includeGuidance: z.boolean().optional(),
  url: z.url(),
});

export default defineTool({
  description:
    "Discover an HTTPS origin's Agentcash-compatible API endpoints and pricing metadata. This is read-only and never makes a payment.",
  inputSchema,
  async execute(input, ctx) {
    requireAgentcashAccess(ctx);
    return callAgentcashMcpTool(
      "discover_api_endpoints",
      safeAgentcashReadInput("discover_api_endpoints", input),
      ctx.abortSignal
    );
  },
});

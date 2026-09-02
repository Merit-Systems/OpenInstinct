import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";
import { safeAgentcashReadInput } from "../lib/agentcash-policy";

const inputSchema = z.object({
  broad: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  page: z.number().int().min(1).optional(),
  query: z.string().min(1),
});

export default defineTool({
  description:
    "Search Agentcash's catalog for paid API endpoints. This is read-only and never makes a payment.",
  inputSchema,
  async execute(input, ctx) {
    requireAgentcashAccess(ctx);
    return callAgentcashMcpTool(
      "search",
      safeAgentcashReadInput("search", input),
      ctx.abortSignal
    );
  },
});

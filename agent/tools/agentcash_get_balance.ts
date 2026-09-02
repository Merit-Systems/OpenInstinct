import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";

export default defineTool({
  description:
    "Get the deployment Agentcash wallet's total balance. This is read-only and never makes a payment.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireAgentcashAccess(ctx);
    return callAgentcashMcpTool("get_balance", {}, ctx.abortSignal);
  },
});

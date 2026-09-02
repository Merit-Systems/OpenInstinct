import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";

export default defineTool({
  description:
    "List the deployment Agentcash wallet accounts, networks, addresses, and balances. This is read-only and never makes a payment.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireAgentcashAccess(ctx);
    return callAgentcashMcpTool("list_accounts", {}, ctx.abortSignal);
  },
});

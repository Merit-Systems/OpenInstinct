import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireAgentcashAccess } from "../lib/agentcash-access";
import { callAgentcashMcpTool } from "../lib/agentcash-mcp";
import { safeAgentcashReadInput } from "../lib/agentcash-policy";

const inputSchema = z.object({
  body: z
    .union([z.string().max(250_000), z.record(z.string(), z.unknown())])
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(["DELETE", "GET", "PATCH", "POST", "PUT"]).optional(),
  url: z.url(),
});

export default defineTool({
  description:
    "Inspect one HTTPS endpoint's schema, authentication mode, and payment requirements before using it. This is read-only and never makes a payment.",
  inputSchema,
  async execute(input, ctx) {
    requireAgentcashAccess(ctx);
    return callAgentcashMcpTool(
      "check_endpoint_schema",
      safeAgentcashReadInput("check_endpoint_schema", input),
      ctx.abortSignal
    );
  },
});

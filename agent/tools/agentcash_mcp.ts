import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  agentcashPrincipalAllowed,
  agentcashWalletConfigured,
  requireAgentcashAccess,
} from "../lib/agentcash-access";
import {
  callAgentcashMcpTool,
  listAgentcashMcpTools,
  type AgentcashMcpToolDefinition,
} from "../lib/agentcash-mcp";
import { safeAgentcashReadInput } from "../lib/agentcash-policy";

const allowedReadTools = new Set([
  "check_endpoint_schema",
  "discover_api_endpoints",
  "get_balance",
  "get_settings",
  "list_accounts",
  "search",
]);
let cachedDefinitions: Promise<AgentcashMcpToolDefinition[]> | undefined;
const mcpInputSchema = z.looseObject({});

async function availableTools() {
  cachedDefinitions ??= listAgentcashMcpTools().catch((error: unknown) => {
    cachedDefinitions = undefined;
    throw error;
  });
  return cachedDefinitions;
}

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      if (
        !agentcashWalletConfigured() ||
        !agentcashPrincipalAllowed(ctx.session)
      ) {
        return null;
      }
      const definitions = (await availableTools()).filter((definition) =>
        allowedReadTools.has(definition.name)
      );
      return Object.fromEntries(
        definitions.map((definition) => [
          `agentcash_${definition.name}`,
          defineTool({
            description: `${definition.description ?? definition.name} This operation never makes a payment. Input JSON Schema: ${JSON.stringify(definition.inputSchema)}`,
            inputSchema: mcpInputSchema,
            async execute(input, toolCtx) {
              requireAgentcashAccess(toolCtx);
              return callAgentcashMcpTool(
                definition.name,
                safeAgentcashReadInput(definition.name, input),
                toolCtx.abortSignal
              );
            },
          }),
        ])
      );
    },
  },
});

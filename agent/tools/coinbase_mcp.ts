import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  coinbasePrincipalAllowed,
  requireCoinbaseAccess,
} from "../lib/coinbase-access";
import { coinbaseCredentialsConfigured } from "../lib/coinbase-cli";
import {
  callCoinbaseMcpTool,
  listCoinbaseMcpTools,
  type CoinbaseMcpToolDefinition,
} from "../lib/coinbase-mcp";
import {
  coinbaseReadTools,
  enforceCoinbaseToolInput,
} from "../lib/coinbase-policy";

let cachedDefinitions: Promise<CoinbaseMcpToolDefinition[]> | undefined;
const mcpInputSchema = z.looseObject({});

async function availableTools() {
  cachedDefinitions ??= listCoinbaseMcpTools().catch((error: unknown) => {
    cachedDefinitions = undefined;
    throw error;
  });
  return cachedDefinitions;
}

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      if (
        !coinbaseCredentialsConfigured() ||
        !coinbasePrincipalAllowed(ctx.session)
      ) {
        return null;
      }
      const definitions = (await availableTools()).filter((definition) =>
        coinbaseReadTools.has(definition.name)
      );
      return Object.fromEntries(
        definitions.map((definition) => [
          definition.name,
          defineTool({
            description: `${definition.description ?? definition.name} This is a read-only Coinbase for Agents operation. Input JSON Schema: ${JSON.stringify(definition.inputSchema)}`,
            inputSchema: mcpInputSchema,
            async execute(input, toolCtx) {
              requireCoinbaseAccess(toolCtx);
              return callCoinbaseMcpTool(
                definition.name,
                enforceCoinbaseToolInput(definition.name, input),
                toolCtx.abortSignal
              );
            },
          }),
        ])
      );
    },
  },
});

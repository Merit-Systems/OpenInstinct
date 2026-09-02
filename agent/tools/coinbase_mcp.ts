import { defineDynamic, defineTool } from "eve/tools";
import {
  coinbaseApprovalPolicy,
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
  coinbaseToolAllowed,
  coinbaseToolRequiresApproval,
  enforceCoinbaseToolInput,
} from "../lib/coinbase-policy";

let cachedDefinitions: Promise<CoinbaseMcpToolDefinition[]> | undefined;

type EveJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly EveJsonValue[]
  | { readonly [key: string]: EveJsonValue };

type EveJsonObject = Readonly<Record<string, EveJsonValue>>;

function parseEveJsonValue(value: unknown): EveJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(parseEveJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).map((key) => {
        const entry: unknown = Reflect.get(value, key);
        return [key, parseEveJsonValue(entry)];
      })
    );
  }
  throw new Error("Coinbase returned a non-JSON tool schema.");
}

function isEveJsonObject(value: EveJsonValue): value is EveJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEveInputSchema(value: unknown): EveJsonObject {
  const parsed = parseEveJsonValue(value);
  if (!isEveJsonObject(parsed)) {
    throw new Error("Coinbase returned an invalid tool input schema.");
  }
  return parsed;
}

async function availableTools() {
  cachedDefinitions ??= listCoinbaseMcpTools().catch((error: unknown) => {
    cachedDefinitions = undefined;
    throw error;
  });
  return cachedDefinitions;
}

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      if (
        !coinbaseCredentialsConfigured() ||
        !coinbasePrincipalAllowed(ctx.session)
      ) {
        return null;
      }
      let definitions: CoinbaseMcpToolDefinition[];
      try {
        definitions = (await availableTools()).filter((definition) =>
          coinbaseToolAllowed(definition.name)
        );
      } catch {
        console.warn(
          "Coinbase tool discovery failed; Coinbase tools are unavailable for this session."
        );
        return null;
      }
      return Object.fromEntries(
        definitions.map((definition) => {
          const requiresApproval = coinbaseToolRequiresApproval(
            definition.name
          );
          return [
            definition.name,
            defineTool({
              description: `${definition.description ?? definition.name} ${requiresApproval ? "This changes Coinbase state or moves funds. The durable approval control authorizes this exact input; do not ask for another preliminary confirmation." : "This is a read-only Coinbase for Agents operation."}`,
              inputSchema: parseEveInputSchema(definition.inputSchema),
              approval:
                coinbaseApprovalPolicy<Record<string, unknown>>(
                  requiresApproval
                ),
              async execute(input, toolCtx) {
                requireCoinbaseAccess(toolCtx);
                const toolInput = enforceCoinbaseToolInput(
                  definition.name,
                  input
                );
                const result = await callCoinbaseMcpTool(
                  definition.name,
                  toolInput,
                  toolCtx.abortSignal
                );
                return requiresApproval
                  ? {
                      note: "This result is authoritative. Do not retry this mutation automatically if its outcome is ambiguous.",
                      result,
                    }
                  : result;
              },
            }),
          ];
        })
      );
    },
  },
});

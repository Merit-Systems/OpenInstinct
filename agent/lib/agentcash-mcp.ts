import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { agentcashChildEnvironment, agentcashCliPath } from "./agentcash-cli";

const initializeTimeoutMs = 15_000;
const toolTimeoutMs = 180_000;
const maximumResultCharacters = 120_000;

export type AgentcashMcpToolDefinition = Pick<
  ListToolsResult["tools"][number],
  "description" | "inputSchema" | "name"
>;

async function createClient(): Promise<MCPClient> {
  return createMCPClient({
    clientName: "openinstinct-agentcash",
    initializationOptions: { timeout: initializeTimeoutMs },
    maxRetries: 0,
    transport: new Experimental_StdioMCPTransport({
      args: [agentcashCliPath, "server"],
      command: process.execPath,
      env: agentcashChildEnvironment(),
      stderr: "inherit",
    }),
    version: "1.0.0",
  });
}

export async function listAgentcashMcpTools() {
  const client = await createClient();
  try {
    const page = await client.listTools({
      options: { timeout: initializeTimeoutMs },
    });
    return page.tools.map((tool): AgentcashMcpToolDefinition => ({
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
      name: tool.name,
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callAgentcashMcpTool(
  name: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
) {
  const client = await createClient();
  try {
    const result = await client.callTool({
      arguments: input,
      name,
      options: { signal, timeout: toolTimeoutMs },
    });
    const selected =
      Reflect.get(result, "structuredContent") ??
      Reflect.get(result, "toolResult") ??
      parseTextResult(result.content);
    if (result.isError) {
      throw new Error(safeResultText(selected));
    }
    const safe = redactSensitiveFields(selected);
    const serialized = safe === undefined ? "" : JSON.stringify(safe);
    if (serialized.length > maximumResultCharacters) {
      throw new Error(
        "Agentcash returned too much data. Retry with a narrower query or endpoint."
      );
    }
    return safe;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function parseTextResult(content: unknown) {
  if (!Array.isArray(content)) return content;
  const text = content
    .map(textContent)
    .filter((value): value is string => value !== undefined)
    .join("\n");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function safeResultText(value: unknown) {
  if (value === undefined) return "Agentcash rejected the request.";
  const message = typeof value === "string" ? value : JSON.stringify(value);
  return message.slice(0, 2_000);
}

function textContent(part: unknown) {
  if (!part || typeof part !== "object") return undefined;
  const type: unknown = Reflect.get(part, "type");
  const text: unknown = Reflect.get(part, "text");
  return type === "text" && typeof text === "string" ? text : undefined;
}

function redactSensitiveFields(value: unknown, key?: string): unknown {
  const normalized = key?.replaceAll(/[-_]/gu, "").toLowerCase();
  if (
    normalized &&
    /(?:authorization|cookie|credential|password|privatekey|secret|setcookie)$/u.test(
      normalized
    )
  ) {
    return "[credential omitted]";
  }
  if (Array.isArray(value))
    return value.map((entry) => redactSensitiveFields(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactSensitiveFields(entry, entryKey),
      ])
    );
  }
  return value;
}

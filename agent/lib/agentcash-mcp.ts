import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { agentcashChildEnvironment, agentcashCliPath } from "./agentcash-cli";

const initializeTimeoutMs = 15_000;
const toolTimeoutMs = 180_000;
const maximumResultCharacters = 120_000;

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;
interface JsonObject {
  [key: string]: JsonValue;
}

export interface AgentcashMcpToolDefinition {
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly name: string;
}

async function createClient(): Promise<MCPClient> {
  return createMCPClient({
    clientName: "openinstinct-agentcash",
    initializationOptions: { timeout: initializeTimeoutMs },
    maxRetries: 0,
    transport: new Experimental_StdioMCPTransport({
      args: [agentcashCliPath],
      command: process.execPath,
      env: agentcashChildEnvironment(),
      stderr: "ignore",
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
      inputSchema: tool.inputSchema as JsonObject,
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
      throw new Error(
        String(selected || "Agentcash rejected the request.").slice(0, 2_000)
      );
    }
    const safe = redactSensitiveFields(selected);
    if (JSON.stringify(safe).length > maximumResultCharacters) {
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
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      Reflect.get(part, "type") === "text" &&
      typeof Reflect.get(part, "text") === "string"
        ? [Reflect.get(part, "text") as string]
        : []
    )
    .join("\n");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
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

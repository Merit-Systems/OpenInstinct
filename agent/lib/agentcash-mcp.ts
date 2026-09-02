import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { agentcashChildEnvironment, agentcashCliPath } from "./agentcash-cli";

const initializeTimeoutMs = 15_000;
const toolTimeoutMs = 180_000;
const maximumResultCharacters = 120_000;
const maximumStoredResultBytes = 100_000;

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
    return boundedAgentcashResult(redactSensitiveFields(selected));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function boundedAgentcashResult(value: unknown) {
  if (value === undefined) return value;
  const serialized = JSON.stringify(value);
  if (
    serialized.length <= maximumResultCharacters &&
    Buffer.byteLength(serialized) <= maximumStoredResultBytes
  ) {
    return value;
  }
  return {
    note: "The paid response completed but was truncated for safe delivery. Do not repay or retry automatically.",
    originalBytes: Buffer.byteLength(serialized),
    preview: truncateUtf8(serialized, maximumStoredResultBytes),
    truncated: true,
  };
}

function truncateUtf8(value: string, maximumBytes: number) {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maximumBytes) return value;
  return buffer.subarray(0, maximumBytes).toString("utf8");
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

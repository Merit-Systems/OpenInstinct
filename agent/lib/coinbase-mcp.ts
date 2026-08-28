import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { coinbaseChildEnvironment, coinbaseCliPath } from "./coinbase-cli";

const initializeTimeoutMs = 10_000;
const toolTimeoutMs = 30_000;
const maximumResultCharacters = 120_000;

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string;
interface JsonObject {
  [key: string]: JsonValue;
}

export interface CoinbaseMcpToolDefinition {
  readonly description?: string;
  readonly inputSchema: JsonObject;
  readonly name: string;
}

async function createClient(): Promise<MCPClient> {
  return createMCPClient({
    clientName: "openinstinct-coinbase",
    initializationOptions: { timeout: initializeTimeoutMs },
    maxRetries: 0,
    transport: new Experimental_StdioMCPTransport({
      args: [coinbaseCliPath, "mcp"],
      command: process.execPath,
      env: coinbaseChildEnvironment(),
      stderr: "ignore",
    }),
    version: "1.0.0",
  });
}

export async function listCoinbaseMcpTools() {
  const client = await createClient();
  try {
    const definitions: CoinbaseMcpToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({
        ...(cursor ? { params: { cursor } } : {}),
        options: { timeout: initializeTimeoutMs },
      });
      for (const tool of page.tools) {
        definitions.push({
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema as JsonObject,
          name: tool.name,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return definitions;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callCoinbaseMcpTool(
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
    if (result.isError) throw new Error(safeResultText(result.content));
    const selected =
      Reflect.get(result, "structuredContent") ??
      Reflect.get(result, "toolResult") ??
      parseTextResult(result.content);
    const safe = redactSensitiveFields(selected);
    const serialized = JSON.stringify(safe);
    if (serialized.length > maximumResultCharacters) {
      throw new Error(
        "Coinbase returned too much data. Retry with a smaller limit or narrower query."
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

function safeResultText(content: unknown) {
  const value = String(
    parseTextResult(content) || "Coinbase rejected the request."
  );
  return value.slice(0, 2_000);
}

function redactSensitiveFields(value: unknown, key?: string): unknown {
  const normalized = key?.replaceAll(/[-_]/gu, "").toLowerCase();
  if (
    normalized &&
    /(?:authorization|credential|password|privatekey|secret|token)$/u.test(
      normalized
    )
  ) {
    return "[credential omitted]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveFields(entry));
  }
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

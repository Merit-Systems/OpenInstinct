import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { coinbaseChildEnvironment, coinbaseCliPath } from "./coinbase-cli";

const initializeTimeoutMs = 10_000;
const toolTimeoutMs = 30_000;
const maximumResultCharacters = 120_000;

export type CoinbaseMcpToolDefinition = Pick<
  ListToolsResult["tools"][number],
  "description" | "inputSchema" | "name"
>;

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
          inputSchema: tool.inputSchema,
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
    const serialized = safe === undefined ? "" : JSON.stringify(safe);
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
    .map(textContent)
    .filter((value): value is string => value !== undefined)
    .join("\n");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function safeResultText(content: unknown) {
  const parsed = parseTextResult(content);
  if (parsed === undefined) return "Coinbase rejected the request.";
  const value = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  return value.slice(0, 2_000);
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
    (/(?:authorization|credential|password|privatekey|secret)$/u.test(
      normalized
    ) ||
      /^(?:access|api|auth|bearer|refresh|session)token$/u.test(normalized))
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

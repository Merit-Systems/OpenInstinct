/* oxlint-disable anti-slop/no-reflect-get, anti-slop/no-runtime-typeof, typescript/no-unsafe-type-assertion -- Eve keeps dynamic callbacks under a private symbol; these tests inspect that framework boundary without adding production exports. */
import type {
  DynamicSentinel,
  DynamicToolResult,
  ToolDefinition,
} from "eve/tools";

export function resolveDynamicTool<TResult>(
  definition: DynamicSentinel<TResult>
) {
  const callback: unknown = Reflect.get(definition, Symbol.for("eve.dynamic"));
  if (typeof callback !== "function") {
    throw new Error("Expected an Eve dynamic definition.");
  }
  // SAFETY: Eve stores the callback passed to defineDynamic under this symbol.
  const resolve = callback as () => TResult | Promise<TResult>;
  return resolve();
}

export async function resolveSingleDynamicTool(
  definition: DynamicSentinel<DynamicToolResult>
) {
  const tool = await resolveDynamicTool(definition);
  if (tool === null) return null;
  if (!("execute" in tool) || typeof tool.execute !== "function") {
    throw new Error("Expected one Eve tool definition.");
  }
  const validated: unknown = tool;
  // SAFETY: The runtime check confirms that the resolved entry has an executor.
  return validated as ToolDefinition;
}

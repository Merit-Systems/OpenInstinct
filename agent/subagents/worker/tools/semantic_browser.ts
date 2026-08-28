import {
  loop,
  type LoopToolExecutionResult,
  type LoopToolSpec,
} from "@onkernel/browser-loop";
import {
  defineDynamic,
  defineTool,
  toolOutput,
  toolOutputPart,
} from "eve/tools";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { executeBrowserLoopTool, modelText } from "@/lib/browser/semantic-loop";

const allSpecs = [
  loop.tools.browser.snapshot(),
  loop.tools.browser.text(),
  loop.tools.browser.find(),
  loop.tools.browser.waitFor(),
  loop.tools.browser.act(),
  loop.tools.playwright(),
];
const specsByName = new Map(allSpecs.map((spec) => [spec.name, spec]));

export default defineDynamic({
  events: {
    "session.started": () => {
      return Object.fromEntries(
        allSpecs.map((spec) => [
          spec.name,
          defineTool({
            description: spec.declaration.description,
            execute: executeSemanticTool,
            inputSchema: withSessionId(spec),
            toModelOutput,
          }),
        ])
      );
    },
  },
});

async function executeSemanticTool(
  input: Record<string, unknown>,
  context: Parameters<typeof requireWorkerScope>[0] & {
    abortSignal?: AbortSignal;
    toolName: string;
  }
) {
  const spec = specsByName.get(context.toolName);
  if (!spec) {
    throw new Error(`Unknown Browser Loop tool: ${context.toolName}`);
  }

  const scope = await requireWorkerScope(context);
  const { sessionId, toolInput } = splitSessionInput(input);
  await requireOwnedBrowserSession(scope, sessionId);
  return executeBrowserLoopTool(
    sessionId,
    spec,
    boundedToolInput(spec, toolInput),
    context.abortSignal
  );
}

function boundedToolInput(spec: LoopToolSpec, input: Record<string, unknown>) {
  if (spec.name === "browser_snapshot" && input.ref === "root") {
    const freshPageInput = { ...input };
    delete freshPageInput.ref;
    return freshPageInput;
  }
  if (spec.name === "browser_act") {
    return {
      ...input,
      timeout_ms: boundedTimeout(input.timeout_ms, 12_000),
    };
  }
  if (spec.name === "playwright_execute") {
    return {
      ...input,
      timeout_sec: boundedTimeout(input.timeout_sec, 20),
    };
  }
  return input;
}

function boundedTimeout(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 1), maximum)
    : maximum;
}

function toModelOutput(output: LoopToolExecutionResult) {
  const parts = output.content.map((part) =>
    part.type === "text"
      ? toolOutputPart.text(part.text)
      : toolOutputPart.file(part.data, { mediaType: part.mimeType })
  );
  return parts.length > 0
    ? toolOutput.content(parts)
    : toolOutput.text(modelText(output));
}

function splitSessionInput(input: Record<string, unknown>) {
  const sessionId = input.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("A browser session ID is required.");
  }
  const { session_id: _sessionId, ...toolInput } = input;
  return { sessionId, toolInput };
}

function withSessionId(spec: LoopToolSpec) {
  const schema: Record<string, unknown> = {
    ...spec.declaration.parameters,
  };
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  return {
    ...schema,
    additionalProperties: false,
    properties: {
      session_id: {
        description: "Owned Kernel browser session ID.",
        minLength: 1,
        type: "string",
      },
      ...properties,
    },
    required: ["session_id", ...required],
    type: "object",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

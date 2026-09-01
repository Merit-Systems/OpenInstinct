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
import { z } from "zod";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import {
  executeBrowserLoopTool,
  modelText,
} from "@/agent/subagents/worker/lib/browser/semantic-loop";

const allSpecs = [
  loop.tools.browser.snapshot(),
  loop.tools.browser.text(),
  loop.tools.browser.find(),
  loop.tools.browser.waitFor(),
  loop.tools.browser.act(),
  loop.tools.playwright(),
];
const specsByName = new Map(allSpecs.map((spec) => [spec.name, spec]));
const relaxedBrowserActTimeoutMs = 8_000;
const relaxedBrowserActSnapshotCharacters = 4_000;
const relaxedBrowserActOutputCharacters = 6_000;
const jsonValueSchema = z.json();
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const sessionIdSchema = z.string().min(1);
const browserActDisplayResultSchema = z.object({
  steps: z.array(
    z.object({
      diagnostics: z.array(z.string()),
      index: z.number().int(),
      type: z.string(),
    })
  ),
  stop_reason: z
    .enum([
      "action_failed",
      "expectation_failed",
      "navigation",
      "stale_ref",
      "dialog",
      "control_flow",
      "step_timeout",
      "global_timeout",
    ])
    .optional(),
  successor: z.discriminatedUnion("status", [
    z.object({ error: z.string(), status: z.literal("unavailable") }),
    z.object({
      diff: z.object({ changed: z.boolean() }),
      status: z.literal("observed"),
      text: z.string(),
      title: z.string(),
      url: z.string(),
    }),
  ]),
});
const browserActReadResultSchema = z.object({
  result: browserActDisplayResultSchema,
  type: z.literal("browser_act"),
});

export default defineDynamic({
  events: {
    "session.started": () => {
      return Object.fromEntries(
        allSpecs.map((spec) => [
          spec.name,
          defineTool({
            description: toolDescription(spec),
            execute: (input, context) =>
              executeSemanticTool(jsonObjectSchema.parse(input), context),
            inputSchema: withSessionId(spec),
            toModelOutput,
          }),
        ])
      );
    },
  },
});

async function executeSemanticTool(
  input: z.infer<typeof jsonObjectSchema>,
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

function boundedToolInput(
  spec: LoopToolSpec,
  input: z.infer<typeof jsonObjectSchema>
) {
  if (spec.name === "browser_snapshot" && input.ref === "root") {
    const freshPageInput = { ...input };
    delete freshPageInput.ref;
    return freshPageInput;
  }
  if (spec.name === "browser_act") {
    return relaxedBrowserActInput(input);
  }
  if (spec.name === "playwright_execute") {
    return {
      ...input,
      timeout_sec: boundedTimeout(input.timeout_sec, 20),
    };
  }
  return input;
}

function boundedTimeout(
  value: z.infer<typeof jsonValueSchema> | undefined,
  maximum: number
) {
  const parsed = z.number().safeParse(value);
  return parsed.success ? Math.min(Math.max(parsed.data, 1), maximum) : maximum;
}

function toModelOutput(output: LoopToolExecutionResult) {
  if (browserActResult(output)) {
    return toolOutput.text(relaxedBrowserActModelText(output));
  }
  const parts = output.content.map((part) =>
    part.type === "text"
      ? toolOutputPart.text(part.text)
      : toolOutputPart.file(part.data, { mediaType: part.mimeType })
  );
  return parts.length > 0
    ? toolOutput.content(parts)
    : toolOutput.text(modelText(output));
}

function splitSessionInput(input: z.infer<typeof jsonObjectSchema>) {
  const sessionId = sessionIdSchema.safeParse(input.session_id);
  if (!sessionId.success) {
    throw new Error("A browser session ID is required.");
  }
  const { session_id: _sessionId, ...toolInput } = input;
  return { sessionId: sessionId.data, toolInput };
}

function withSessionId(spec: LoopToolSpec) {
  const schema = jsonObjectSchema.parse({
    ...(spec.name === "browser_act"
      ? relaxedBrowserActSchema(spec.declaration.parameters)
      : spec.declaration.parameters),
  });
  const properties = jsonObjectSchema.safeParse(schema.properties);
  const required = z.array(z.string()).safeParse(schema.required);
  const inputProperties = properties.success ? properties.data : {};
  inputProperties.session_id = {
    description: "Owned Kernel browser session ID.",
    minLength: 1,
    type: "string",
  };
  return {
    ...schema,
    additionalProperties: false,
    properties: inputProperties,
    required: ["session_id", ...(required.success ? required.data : [])],
    type: "object",
  };
}

function toolDescription(spec: LoopToolSpec) {
  if (spec.name !== "browser_act") return spec.declaration.description;
  return "Run 1–8 short dependent browser actions against current refs without waiting for model-authored postconditions. The result distinguishes dispatch failures and browser boundaries, then returns a compact successor state. Use current refs from browser_snapshot or browser_find; snapshot again after navigation, a stale ref, or an unavailable successor.";
}

function relaxedBrowserActInput(input: z.infer<typeof jsonObjectSchema>) {
  const {
    expect: _expect,
    poll_ms: _pollMs,
    timeout_ms: _timeoutMs,
    ...relaxed
  } = input;
  const steps = Array.isArray(relaxed.steps)
    ? relaxed.steps.map((step) => {
        const parsed = jsonObjectSchema.safeParse(step);
        if (!parsed.success) {
          throw new Error("A relaxed browser action step must be an object.");
        }
        const {
          expect: _stepExpect,
          timeout_ms: _stepTimeoutMs,
          ...action
        } = parsed.data;
        return action;
      })
    : relaxed.steps;
  const parsedSuccessor = jsonObjectSchema.safeParse(relaxed.successor);
  const successor = parsedSuccessor.success
    ? {
        ...parsedSuccessor.data,
        depth: boundedTimeout(parsedSuccessor.data.depth, 8),
      }
    : { depth: 6, filter: "interactive" };
  if (steps === undefined) {
    return jsonObjectSchema.parse({
      ...relaxed,
      successor,
      timeout_ms: relaxedBrowserActTimeoutMs,
    });
  }
  return jsonObjectSchema.parse({
    ...relaxed,
    steps,
    successor,
    timeout_ms: relaxedBrowserActTimeoutMs,
  });
}

function relaxedBrowserActSchema(
  value: LoopToolSpec["declaration"]["parameters"]
) {
  const parsed = jsonObjectSchema.safeParse(structuredClone(value));
  if (!parsed.success) return {};
  const schema = parsed.data;
  const parsedProperties = jsonObjectSchema.safeParse(schema.properties);
  const properties = parsedProperties.success ? parsedProperties.data : {};
  delete properties.expect;
  delete properties.poll_ms;
  delete properties.timeout_ms;

  const parsedSteps = jsonObjectSchema.safeParse(properties.steps);
  if (parsedSteps.success) {
    const steps = parsedSteps.data;
    steps.maxItems = 8;
    const parsedItems = jsonObjectSchema.safeParse(steps.items);
    const variants =
      parsedItems.success && Array.isArray(parsedItems.data.anyOf)
        ? parsedItems.data.anyOf
        : [];
    for (const variant of variants) {
      const parsedVariant = jsonObjectSchema.safeParse(variant);
      if (!parsedVariant.success) continue;
      const parsedStepProperties = jsonObjectSchema.safeParse(
        parsedVariant.data.properties
      );
      if (!parsedStepProperties.success) continue;
      const stepProperties = parsedStepProperties.data;
      delete stepProperties.expect;
      delete stepProperties.timeout_ms;
    }
  }
  return schema;
}

function relaxedBrowserActModelText(output: LoopToolExecutionResult) {
  const result = browserActResult(output);
  if (!result) {
    return truncate(modelText(output), relaxedBrowserActOutputCharacters);
  }

  const dispatched = result.steps.filter((step) =>
    step.diagnostics.includes("action dispatched")
  ).length;
  const uncertain =
    result.stop_reason === "action_failed" ||
    result.stop_reason === "global_timeout" ||
    result.stop_reason === "step_timeout";
  const status =
    dispatched === 0
      ? "not_dispatched"
      : uncertain
        ? "uncertain"
        : "dispatched";
  const lines = [
    `browser_act: ${status}`,
    `dispatched_steps: ${String(dispatched)}`,
  ];
  if (result.stop_reason) lines.push(`boundary: ${result.stop_reason}`);
  for (const step of result.steps) {
    const diagnostics = step.diagnostics.filter(
      (diagnostic) => diagnostic !== "action dispatched"
    );
    if (diagnostics.length > 0) {
      lines.push(
        `step ${String(step.index)} ${step.type}: ${diagnostics.join("; ")}`
      );
    }
  }

  if (result.successor.status === "unavailable") {
    lines.push(`successor unavailable: ${result.successor.error}`);
  } else {
    lines.push(
      `state_changed: ${String(result.successor.diff.changed)}`,
      `successor: ${result.successor.title} (${result.successor.url})`,
      "current interactive state:",
      truncate(result.successor.text, relaxedBrowserActSnapshotCharacters)
    );
  }
  return truncate(lines.join("\n"), relaxedBrowserActOutputCharacters);
}

function browserActResult(output: LoopToolExecutionResult) {
  for (const read of output.details.readResults ?? []) {
    const parsed = browserActReadResultSchema.safeParse(read);
    if (parsed.success) return parsed.data.result;
  }
  return undefined;
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${String(value.length - limit)} characters]`;
}

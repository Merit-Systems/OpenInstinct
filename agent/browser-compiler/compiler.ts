import Kernel from "@onkernel/sdk";
import type {
  BrowserNetworkRequestEvent,
  BrowserNetworkResponseEvent,
} from "@onkernel/sdk/resources/browsers/telemetry";
import { z } from "zod";

import { getEnv } from "../../env.js";

export const compilerParameterSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Parameter names must use lowercase letters, numbers, and underscores."
    ),
  example: z.string().min(1),
});

const jsonShapeSchema = z.object({
  kind: z.enum(["array", "object", "string", "number", "boolean", "null"]),
  keys: z.array(z.string()),
  itemKind: z
    .enum(["array", "object", "string", "number", "boolean", "null"])
    .optional(),
  itemKeys: z.array(z.string()).optional(),
});

export const compiledBrowserRequestSchema = z.object({
  name: z.string(),
  method: z.literal("GET"),
  urlTemplate: z.string().url(),
  parameters: z.array(compilerParameterSchema),
  expected: z.object({
    status: z.number().int(),
    shape: jsonShapeSchema,
  }),
  sourceHost: z.string(),
  createdAt: z.string().datetime(),
});

export type CompiledBrowserRequest = z.infer<
  typeof compiledBrowserRequestSchema
>;
type JsonShape = z.infer<typeof jsonShapeSchema>;

interface JoinedNetworkRequest {
  request: BrowserNetworkRequestEvent;
  response?: BrowserNetworkResponseEvent;
}

const sensitiveQueryName =
  /(?:^|[-_])(auth|code|credential|key|password|secret|session|signature|token)(?:$|[-_])/i;
const trackerHost =
  /(?:^|\.)(?:amplitude|datadoghq|google-analytics|googletagmanager|hotjar|mixpanel|segment|sentry)\./i;
const trackerPath = /(?:beacon|pixel|telemetry|track|analytics)/i;

export function createKernelClient() {
  return new Kernel({ apiKey: getEnv().KERNEL_API_KEY });
}

export async function enableCompilerTelemetry(
  kernel: Kernel,
  browserSessionId: string
) {
  await kernel.browsers.update(browserSessionId, {
    telemetry: {
      enabled: true,
      browser: {
        interaction: { enabled: true },
        network: { enabled: true },
        page: { enabled: true },
      },
    },
  });
}

export async function readJoinedNetworkRequests(
  kernel: Kernel,
  browserSessionId: string,
  since: string
) {
  const requests = new Map<string, BrowserNetworkRequestEvent>();
  const responses = new Map<string, BrowserNetworkResponseEvent>();

  for await (const envelope of kernel.browsers.telemetry.events(
    browserSessionId,
    {
      category: ["network"],
      since,
    }
  )) {
    const event = envelope.event;
    if (event.type === "network_request" && event.data?.request_id) {
      requests.set(event.data.request_id, event);
    }
    if (event.type === "network_response" && event.data?.request_id) {
      responses.set(event.data.request_id, event);
    }
  }

  return [...requests.entries()].map<JoinedNetworkRequest>(
    ([requestId, request]) => ({
      request,
      response: responses.get(requestId),
    })
  );
}

export function findRequestById(
  requests: JoinedNetworkRequest[],
  requestId: string
) {
  return requests.find((entry) => entry.request.data?.request_id === requestId);
}

export function toCompilerCandidates(requests: JoinedNetworkRequest[]) {
  return requests
    .filter(isCompilerCandidate)
    .map(({ request, response }) => ({
      requestId: request.data?.request_id,
      method: request.data?.method,
      url: redactUrl(request.data?.url),
      resourceType: request.data?.resource_type,
      status: response?.data?.status,
      mimeType: response?.data?.mime_type,
      observedAt: new Date(request.ts / 1_000).toISOString(),
      responseShape: inferJsonShape(response?.data?.body),
    }))
    .slice(-50)
    .reverse();
}

export function assertCompilableRequest(
  entry: JoinedNetworkRequest | undefined
) {
  if (!entry) {
    throw new Error(
      "That request ID was not found in the active trace window."
    );
  }
  if (!isCompilerCandidate(entry)) {
    throw new Error(
      "This MVP only compiles successful JSON GET requests observed as fetch/XHR traffic."
    );
  }

  const url = entry.request.data?.url;
  if (!url) throw new Error("The observed request did not include a URL.");
  return url;
}

export function compileUrlTemplate(
  url: string,
  parameters: z.infer<typeof compilerParameterSchema>[]
) {
  const uniqueNames = new Set(parameters.map(({ name }) => name));
  if (uniqueNames.size !== parameters.length) {
    throw new Error("Each compiler parameter must have a unique name.");
  }

  let template = url;
  for (const parameter of [...parameters].sort(
    (left, right) => right.example.length - left.example.length
  )) {
    const encoded = encodeURIComponent(parameter.example);
    const formEncoded = new URLSearchParams({ value: parameter.example })
      .toString()
      .slice("value=".length);
    const forms = [
      ...new Set([encoded, formEncoded, parameter.example]),
    ].filter(Boolean);
    const matched = forms.some((form) => template.includes(form));
    if (!matched) {
      throw new Error(
        `The example for parameter "${parameter.name}" does not occur in the observed URL.`
      );
    }
    for (const form of forms) {
      template = template.replaceAll(form, `{{${parameter.name}}}`);
    }
  }

  return template;
}

export function renderCompiledUrl(
  compiled: CompiledBrowserRequest,
  values: Record<string, string>
) {
  const expectedNames = new Set(compiled.parameters.map(({ name }) => name));
  const unexpectedNames = Object.keys(values).filter(
    (name) => !expectedNames.has(name)
  );
  if (unexpectedNames.length > 0) {
    throw new Error(`Unexpected parameters: ${unexpectedNames.join(", ")}.`);
  }

  let url = compiled.urlTemplate;
  for (const { name } of compiled.parameters) {
    const value = values[name];
    if (value === undefined)
      throw new Error(`Missing required parameter "${name}".`);
    url = url.replaceAll(`{{${name}}}`, encodeURIComponent(value));
  }
  if (/{{[a-z][a-z0-9_]*}}/.test(url)) {
    throw new Error("The compiled URL still contains unresolved parameters.");
  }
  return url;
}

export function inferJsonShape(body: string | undefined): JsonShape | null {
  if (!body) return null;
  try {
    return inferJsonValueShape(JSON.parse(body));
  } catch {
    return null;
  }
}

function inferJsonValueShape(value: unknown): JsonShape {
  const kind = jsonKind(value);
  if (kind === "object") {
    return {
      kind,
      keys: Object.keys(value as Record<string, unknown>).slice(0, 20),
    };
  }
  if (kind === "array") {
    const items = value as unknown[];
    const first = items[0];
    const itemKind = items.length > 0 ? jsonKind(first) : undefined;
    return {
      kind,
      keys: [],
      ...(itemKind ? { itemKind } : {}),
      ...(itemKind === "object"
        ? {
            itemKeys: Object.keys(first as Record<string, unknown>).slice(
              0,
              20
            ),
          }
        : {}),
    };
  }
  return { kind, keys: [] };
}

export function validateJsonShape(value: unknown, expected: JsonShape) {
  const actual = inferJsonValueShape(value);
  const errors: string[] = [];
  if (actual.kind !== expected.kind) {
    errors.push(`Expected ${expected.kind}, received ${actual.kind}.`);
    return errors;
  }
  if (expected.kind === "object") {
    const actualKeys = new Set(actual.keys);
    for (const key of expected.keys.slice(0, 10)) {
      if (!actualKeys.has(key)) errors.push(`Missing top-level key "${key}".`);
    }
  }
  if (expected.kind === "array" && expected.itemKind && actual.itemKind) {
    if (actual.itemKind !== expected.itemKind) {
      errors.push(
        `Expected array items to be ${expected.itemKind}, received ${actual.itemKind}.`
      );
    }
    if (expected.itemKind === "object" && actual.itemKind === "object") {
      const actualKeys = new Set(actual.itemKeys ?? []);
      for (const key of (expected.itemKeys ?? []).slice(0, 10)) {
        if (!actualKeys.has(key))
          errors.push(`Missing array item key "${key}".`);
      }
    }
  }
  return errors;
}

export function limitJsonForModel(value: unknown, depth = 0): unknown {
  if (depth >= 6) return "[depth limit]";
  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  if (Array.isArray(value)) {
    const limited = value
      .slice(0, 20)
      .map((item) => limitJsonForModel(item, depth + 1));
    if (value.length > 20) limited.push(`[${value.length - 20} more items]`);
    return limited;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [key, limitJsonForModel(item, depth + 1)])
    );
  }
  return value;
}

export function codePreview(compiled: CompiledBrowserRequest) {
  const parameterList = compiled.parameters.map(({ name }) => name).join(", ");
  return [
    `async function ${compiled.name}(kernel, browserSessionId, { ${parameterList} }) {`,
    `  const url = \`${compiled.urlTemplate.replaceAll("{{", "${encodeURIComponent(").replaceAll("}}", ")}")}\`;`,
    "  return kernel.browsers.curl(browserSessionId, {",
    '    method: "GET",',
    "    url,",
    '    response_encoding: "utf8",',
    "  });",
    "}",
  ].join("\n");
}

function isCompilerCandidate({ request, response }: JoinedNetworkRequest) {
  const requestData = request.data;
  const responseData = response?.data;
  if (
    requestData?.method?.toUpperCase() !== "GET" ||
    !requestData.url ||
    !requestData.request_id ||
    !responseData?.status ||
    responseData.status < 200 ||
    responseData.status >= 300 ||
    !responseData.mime_type?.toLowerCase().includes("json") ||
    !["fetch", "xhr"].includes(requestData.resource_type?.toLowerCase() ?? "")
  ) {
    return false;
  }

  try {
    const parsed = new URL(requestData.url);
    return (
      !trackerHost.test(parsed.hostname) && !trackerPath.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function redactUrl(url: string | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const name of parsed.searchParams.keys()) {
      if (sensitiveQueryName.test(name))
        parsed.searchParams.set(name, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return "[unparseable URL]";
  }
}

function jsonKind(value: unknown): JsonShape["kind"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

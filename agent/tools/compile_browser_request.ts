import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  assertCompilableRequest,
  codePreview,
  compiledBrowserRequestSchema,
  compilerParameterSchema,
  compileUrlTemplate,
  createKernelClient,
  findRequestById,
  inferJsonShape,
  readJoinedNetworkRequests,
} from "../browser-compiler/compiler.js";
import { browserCompilerState } from "../browser-compiler/state.js";

export default defineTool({
  description:
    "Compile one observed, successful JSON GET request into a parameterized request that can be replayed through the same Kernel browser identity. This refuses writes and never persists observed headers, cookies, or credentials.",
  inputSchema: z.object({
    browserSessionId: z.string().min(1),
    requestId: z.string().min(1),
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "Use a lowercase snake_case task name."),
    parameters: z.array(compilerParameterSchema).min(1).max(10),
  }),
  async execute({ browserSessionId, requestId, name, parameters }) {
    const trace = browserCompilerState.get().traces[browserSessionId];
    if (!trace)
      throw new Error("No compiler trace is active for this browser session.");

    const kernel = createKernelClient();
    const requests = await readJoinedNetworkRequests(
      kernel,
      browserSessionId,
      trace.startedAt
    );
    const observedUrl = assertCompilableRequest(
      findRequestById(requests, requestId)
    );
    const urlTemplate = compileUrlTemplate(observedUrl, parameters);

    const baselineStartedAt = performance.now();
    const baseline = await kernel.browsers.curl(browserSessionId, {
      method: "GET",
      url: observedUrl,
      response_encoding: "utf8",
      timeout_ms: 30_000,
    });
    const shape = inferJsonShape(baseline.body);
    if (baseline.status < 200 || baseline.status >= 300 || !shape) {
      throw new Error(
        "The candidate could not be verified as a successful JSON request through Kernel browser curl."
      );
    }

    const compiled = compiledBrowserRequestSchema.parse({
      name,
      method: "GET",
      urlTemplate,
      parameters,
      expected: { status: baseline.status, shape },
      sourceHost: new URL(observedUrl).hostname,
      createdAt: new Date().toISOString(),
    });
    browserCompilerState.update((state) => ({
      ...state,
      requests: { ...state.requests, [name]: compiled },
    }));

    return {
      compiled,
      verificationDurationMs: Math.round(performance.now() - baselineStartedAt),
      codePreview: codePreview(compiled),
      storage: "This Eve chat session only",
      next: "Call run_compiled_browser_request with the same live browser session and a different parameter value to verify the warm path.",
    };
  },
});

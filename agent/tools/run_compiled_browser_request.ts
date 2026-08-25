import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createKernelClient,
  limitJsonForModel,
  renderCompiledUrl,
  validateJsonShape,
} from "../browser-compiler/compiler.js";
import { browserCompilerState } from "../browser-compiler/state.js";

export default defineTool({
  description:
    "Run a previously compiled browser request through a live Kernel browser session, then check its HTTP status and JSON shape. Use this instead of browser automation for a matching learned read task.",
  inputSchema: z.object({
    name: z.string().min(1),
    browserSessionId: z.string().min(1),
    parameters: z.record(z.string(), z.string()),
  }),
  async execute({ name, browserSessionId, parameters }) {
    const compiled = browserCompilerState.get().requests[name];
    if (!compiled) {
      throw new Error(
        `No compiled browser request named "${name}" exists in this chat session.`
      );
    }

    const url = renderCompiledUrl(compiled, parameters);
    const startedAt = performance.now();
    const response = await createKernelClient().browsers.curl(
      browserSessionId,
      {
        method: "GET",
        url,
        response_encoding: "utf8",
        timeout_ms: 30_000,
      }
    );
    const durationMs = Math.round(performance.now() - startedAt);

    let data: unknown;
    try {
      data = JSON.parse(response.body);
    } catch {
      return {
        ok: false,
        durationMs,
        status: response.status,
        errors: ["The response was not valid JSON."],
        bodyPreview: response.body.slice(0, 2_000),
        fallback:
          "Use normal browser automation and consider recompiling from a fresh trace.",
      };
    }

    const errors = [
      ...(response.status === compiled.expected.status
        ? []
        : [
            `Expected HTTP ${compiled.expected.status}, received ${response.status}.`,
          ]),
      ...validateJsonShape(data, compiled.expected.shape),
    ];
    return {
      ok: errors.length === 0,
      durationMs,
      status: response.status,
      validation: errors.length === 0 ? "passed" : "failed",
      errors,
      data: limitJsonForModel(data),
      fallback:
        errors.length === 0
          ? null
          : "Use normal browser automation and consider recompiling from a fresh trace.",
    };
  },
});

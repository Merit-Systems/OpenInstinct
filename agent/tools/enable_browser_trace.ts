import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createKernelClient,
  enableCompilerTelemetry,
} from "../browser-compiler/compiler.js";
import { browserCompilerState } from "../browser-compiler/state.js";

export default defineTool({
  description:
    "Start Kernel network telemetry before performing a browser task that the user explicitly wants compiled. Call this immediately after creating the Kernel browser session.",
  inputSchema: z.object({
    browserSessionId: z.string().min(1),
  }),
  async execute({ browserSessionId }) {
    const startedAt = new Date().toISOString();
    await enableCompilerTelemetry(createKernelClient(), browserSessionId);
    browserCompilerState.update((state) => ({
      ...state,
      traces: { ...state.traces, [browserSessionId]: { startedAt } },
    }));
    return {
      browserSessionId,
      startedAt,
      enabledCategories: ["network", "interaction", "page"],
      next: "Perform the browser task normally, then call inspect_browser_trace before deleting the browser session.",
    };
  },
});

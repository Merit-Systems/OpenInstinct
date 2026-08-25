import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createKernelClient,
  readJoinedNetworkRequests,
  toCompilerCandidates,
} from "../browser-compiler/compiler.js";
import { browserCompilerState } from "../browser-compiler/state.js";

export default defineTool({
  description:
    "Inspect the safe, read-only JSON API candidates observed during an enabled Kernel browser trace. Raw headers, cookies, credentials, and response bodies are intentionally omitted.",
  inputSchema: z.object({
    browserSessionId: z.string().min(1),
  }),
  async execute({ browserSessionId }) {
    const trace = browserCompilerState.get().traces[browserSessionId];
    if (!trace) {
      throw new Error("No compiler trace is active for this browser session.");
    }
    const requests = await readJoinedNetworkRequests(
      createKernelClient(),
      browserSessionId,
      trace.startedAt
    );
    const candidates = toCompilerCandidates(requests);
    return {
      browserSessionId,
      candidateCount: candidates.length,
      candidates,
      next:
        candidates.length > 0
          ? "Choose the request that produced the useful browser result and call compile_browser_request."
          : "No supported request was observed. This compiler currently requires successful JSON fetch/XHR GET traffic.",
    };
  },
});

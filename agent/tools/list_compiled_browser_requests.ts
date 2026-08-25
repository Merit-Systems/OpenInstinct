import { defineTool } from "eve/tools";
import { z } from "zod";

import { browserCompilerState } from "../browser-compiler/state.js";

export default defineTool({
  description:
    "List browser requests compiled earlier in this Eve chat session. Use this before raw browser automation when the user's task may already have a learned request.",
  inputSchema: z.object({}),
  execute() {
    const requests = Object.values(browserCompilerState.get().requests).map(
      (request) => ({
        name: request.name,
        method: request.method,
        sourceHost: request.sourceHost,
        parameters: request.parameters.map(({ name }) => name),
        expected: request.expected,
        createdAt: request.createdAt,
      })
    );
    return { count: requests.length, requests };
  },
});

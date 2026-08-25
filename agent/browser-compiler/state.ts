import { defineState } from "eve/context";

import type { CompiledBrowserRequest } from "./compiler.js";

export const browserCompilerState = defineState(
  "eve-kernel.browser-compiler",
  () => ({
    traces: {} as Record<string, { startedAt: string }>,
    requests: {} as Record<string, CompiledBrowserRequest>,
  })
);

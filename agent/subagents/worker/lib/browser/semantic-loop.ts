import {
  LoopExecutionResources,
  type BrowserRefState,
  type LoopToolExecutionResult,
  type LoopToolSpec,
} from "@onkernel/browser-loop";
import { defineState } from "eve/context";
import { z } from "zod";
import { kernel } from "@/lib/kernel";

const browserLoopInputSchema = z.record(z.string(), z.json());
const resourcesBySession = new Map<string, LoopExecutionResources>();
const lockTailsBySession = new Map<string, Promise<void>>();
const refStates = defineState<Record<string, BrowserRefState>>(
  "worker.browser-loop.refs",
  () => ({})
);

export async function executeBrowserLoopTool(
  sessionId: string,
  spec: LoopToolSpec,
  input: z.infer<typeof browserLoopInputSchema>,
  signal?: AbortSignal
) {
  return withBrowserLoopSessionLock(sessionId, async () => {
    const resources = await resourcesFor(sessionId, signal);
    let output: LoopToolExecutionResult | undefined;

    try {
      output = await resources.materialize(spec).execute(input, signal);
    } finally {
      const state = resources.browserExecutor().exportRefState();
      refStates.update((current) => ({ ...current, [sessionId]: state }));
    }

    return output;
  });
}

export async function disposeBrowserLoopSession(sessionId: string) {
  await withBrowserLoopSessionLock(sessionId, async () => {
    const resources = resourcesBySession.get(sessionId);
    resourcesBySession.delete(sessionId);
    refStates.update((current) => {
      const { [sessionId]: _removed, ...remaining } = current;
      return remaining;
    });
    await resources?.dispose();
  });
}

export function modelText(output: LoopToolExecutionResult) {
  return output.content
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[${part.mimeType} image omitted from text output]`
    )
    .join("\n");
}

async function resourcesFor(sessionId: string, signal?: AbortSignal) {
  const cached = resourcesBySession.get(sessionId);
  if (cached) return cached;

  const browser = await kernel.browsers.retrieve(sessionId, {}, { signal });

  type Options = ConstructorParameters<typeof LoopExecutionResources>[0];
  const resources = new LoopExecutionResources({
    browser,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Browser Loop pins an older nominal Kernel SDK type, while this app supplies the API-compatible shared client required by the repository contract.
    client: kernel as typeof kernel & Options["client"],
  });
  const refState = refStates.get()[sessionId];
  if (refState) {
    resources.browserExecutor().importRefState(refState);
  }
  resourcesBySession.set(sessionId, resources);
  return resources;
}

async function withBrowserLoopSessionLock<T>(
  sessionId: string,
  operation: () => Promise<T>
) {
  const previous = lockTailsBySession.get(sessionId) ?? Promise.resolve();
  const { promise: current, resolve: release } =
    Promise.withResolvers<undefined>();
  const tail = previous.then(() => current);
  lockTailsBySession.set(sessionId, tail);
  await previous;

  try {
    return await operation();
  } finally {
    release(undefined);
    if (lockTailsBySession.get(sessionId) === tail) {
      lockTailsBySession.delete(sessionId);
    }
  }
}

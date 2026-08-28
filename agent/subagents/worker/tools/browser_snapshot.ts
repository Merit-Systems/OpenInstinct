import {
  BrowserExecutor,
  loop,
  type BrowserActionSnapshot,
} from "@onkernel/browser-loop";
import { defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { withVaultBrowserObservationMask } from "@/agent/subagents/worker/lib/vault-screenshot-mask";
import { withBrowserRefState } from "@/db/services/browsers";
import { kernel } from "@/lib/kernel";

const spec = loop.tools.browser.snapshot();
const browserSnapshotDeadlineMs = 15_000;
const inputSchema = withSessionId(spec.declaration.parameters);
const outputSchema = z.object({ message: z.string() });

export default defineTool({
  description: `${spec.declaration.description} The session must belong to the current workspace. Vault-filled controls are hidden from the observation.`,
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);
    const sessionId = requiredSessionId(input.session_id);
    await requireOwnedBrowserSession(scope, sessionId);

    const outcome = await withBrowserRefState(
      scope,
      sessionId,
      async (refState) => {
        const executor = await browserExecutor(sessionId, context.abortSignal);
        let result: BrowserAttempt<string>;
        try {
          if (refState) executor.importRefState(refState);
          const reads = await withVaultBrowserObservationMask(
            sessionId,
            context.abortSignal,
            () =>
              executeWithDeadline(
                executor,
                () =>
                  executor.execute(snapshotAction(input), context.abortSignal),
                context.abortSignal,
                browserSnapshotDeadlineMs,
                "Browser snapshot"
              )
          );
          const snapshot = reads.find(
            (read) => read.type === "browser_text" && read.label === "snapshot"
          );
          result =
            snapshot?.type === "browser_text"
              ? { ok: true, value: snapshot.text }
              : {
                  error: new Error("Browser Loop returned no page snapshot."),
                  ok: false,
                };
        } catch (error) {
          result = { error: safeBrowserLoopError(error), ok: false };
        } finally {
          executor.close();
        }
        return { refState: executor.exportRefState(), result };
      }
    );
    if (!outcome.ok) throw outcome.error;
    return outputSchema.parse({ message: outcome.value });
  },
  toModelOutput(output) {
    return toolOutput.text(output.message);
  },
});

type BrowserAttempt<T> = { ok: true; value: T } | { error: unknown; ok: false };

async function browserExecutor(
  sessionId: string,
  signal: AbortSignal | undefined
) {
  const browser = await kernel.browsers.retrieve(sessionId, {}, { signal });
  if (!browser.cdp_ws_url) {
    throw new Error("The Kernel browser has no CDP connection URL.");
  }
  return new BrowserExecutor(browser.cdp_ws_url);
}

function requiredSessionId(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("A browser session ID is required.");
  }
  return value;
}

function snapshotAction(input: Record<string, unknown>) {
  const { session_id: _sessionId, ...parameters } = input;
  // The model input was already validated against Browser Loop's owning schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Browser Loop owns and validated the exact parameter schema before Eve invokes this tool.
  return { ...parameters, type: "browser_snapshot" } as BrowserActionSnapshot;
}

function withSessionId(schema: unknown) {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    throw new Error("Browser Loop returned an invalid tool schema.");
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  return {
    ...schema,
    properties: {
      session_id: {
        description: "Owned Kernel browser session ID.",
        minLength: 1,
        type: "string",
      },
      ...schema.properties,
    },
    required: [...required, "session_id"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executeWithDeadline<T>(
  executor: BrowserExecutor,
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  label: string
) {
  if (signal?.aborted) return Promise.reject(new Error(`${label} cancelled.`));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      complete();
    };
    const stop = (message: string) => {
      executor.close();
      finish(() => {
        reject(new Error(message));
      });
    };
    const cancel = () => {
      stop(`${label} cancelled.`);
    };
    const timer = setTimeout(() => {
      stop(`${label} timed out after ${String(timeoutMs)}ms.`);
    }, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    void operation().then(
      (value) => {
        finish(() => {
          resolve(value);
        });
        return undefined;
      },
      (error: unknown) => {
        const failure =
          error instanceof Error
            ? error
            : new Error("Browser snapshot failed.");
        finish(() => {
          reject(failure);
        });
        return undefined;
      }
    );
  });
}

function safeBrowserLoopError(error: unknown) {
  if (!(error instanceof Error)) {
    return new Error("Browser snapshot failed.");
  }
  return new Error(
    error.message.replaceAll(
      /\bwss?:\/\/[^\s"'<>]+/giu,
      "[redacted browser session URL]"
    )
  );
}

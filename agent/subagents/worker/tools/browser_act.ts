import {
  BrowserExecutor,
  formatBrowserActResult,
  loop,
  loopToolMenu,
  type BrowserActionAct,
  type BrowserActResult,
} from "@onkernel/browser-loop";
import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { z } from "zod";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { getModelSettings } from "@/lib/model-config";
import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";
import { requireOwnedBrowserSession } from "@/agent/subagents/worker/lib/owned-browser";
import { withVaultBrowserObservationMask } from "@/agent/subagents/worker/lib/vault-screenshot-mask";
import { withBrowserRefState } from "@/db/services/browsers";
import { kernel } from "@/lib/kernel";

const spec = loop.tools.browser.act();
const browserActDeadlineMs = 35_000;
const inputSchema = withSessionId(spec.declaration.parameters);
const outputSchema = z.object({
  message: z.string(),
  outcome: z.enum(["worked", "didnt", "unknown"]),
  stopReason: z.string().optional(),
});

export const browserActTool = defineTool({
  description: `${spec.declaration.description} The session must belong to the current workspace. Vault-filled controls are hidden from successor observations.`,
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
        let result: BrowserAttempt<BrowserActResult>;
        try {
          if (refState) executor.importRefState(refState);
          const reads = await withVaultBrowserObservationMask(
            sessionId,
            context.abortSignal,
            () =>
              executeWithDeadline(
                executor,
                () => executor.execute(actAction(input), context.abortSignal),
                context.abortSignal,
                browserActDeadlineMs,
                "Browser action"
              )
          );
          const act = reads.find((read) => read.type === "browser_act");
          result = act
            ? { ok: true, value: act.result }
            : {
                error: new Error("Browser Loop returned no action result."),
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

    const message = sanitizeBrowserLoopMessage(
      formatBrowserActResult(outcome.value)
    );
    if (
      outcome.value.outcome === "didnt" ||
      (outcome.value.outcome === "unknown" && outcome.value.stop_reason)
    ) {
      throw new Error(message);
    }
    return outputSchema.parse({
      message,
      outcome: outcome.value.outcome,
      stopReason: outcome.value.stop_reason,
    });
  },
  toModelOutput(output) {
    return toolOutput.text(output.message);
  },
});

export default defineDynamic({
  events: {
    "turn.started": async (_event, context) => {
      const caller =
        context.session.auth.current ?? context.session.auth.initiator;
      if (!caller) throw new Error("An authenticated user is required.");
      const { modelId } = await getModelSettings(scopeFromPrincipal(caller));
      return browserActAvailableForModel(modelId) ? browserActTool : null;
    },
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

function actAction(input: Record<string, unknown>) {
  const { session_id: _sessionId, ...parameters } = input;
  // The model input was already validated against Browser Loop's owning schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Browser Loop owns and validated the exact parameter schema before Eve invokes this tool.
  return { ...parameters, type: "browser_act" } as BrowserActionAct;
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

export function browserActAvailableForModel(modelId: string) {
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) return false;
  const modelRef: `${string}:${string}` = `${modelId.slice(0, separator)}:${modelId.slice(separator + 1)}`;
  try {
    return (
      loopToolMenu(modelRef).find((entry) => entry.key === spec.identity)
        ?.available === true
    );
  } catch {
    return false;
  }
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
          error instanceof Error ? error : new Error("Browser action failed.");
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
    return new Error("Browser action failed.");
  }
  return new Error(sanitizeBrowserLoopMessage(error.message));
}

function sanitizeBrowserLoopMessage(message: string) {
  return message.replaceAll(
    /\bwss?:\/\/[^\s"'<>]+/giu,
    "[redacted browser session URL]"
  );
}

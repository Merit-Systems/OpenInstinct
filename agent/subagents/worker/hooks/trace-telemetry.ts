import { defineHook } from "eve/hooks";
import type { HookContext } from "eve/hooks";
import {
  beginBrowserTrace,
  completeBrowserTrace,
  recordBrowserTraceEvents,
} from "@/db/services/browser-traces";
import { traceTimelineRows } from "@/agent/subagents/worker/lib/trace-timeline";
import { listWorkerBrowserSessions } from "@/db/services/browsers";
import type { AccessScope } from "@/lib/access-scope";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { taskCompletionOutputSchema } from "@/lib/worker-completion";
import { harvestBrowserTraceDomains } from "@/agent/subagents/worker/lib/trace-domains";

export const traceTelemetryDependencies = {
  beginBrowserTrace,
  completeBrowserTrace,
  harvestBrowserTraceDomains,
  listWorkerBrowserSessions,
  recordBrowserTraceEvents,
};

function traceScope(ctx: HookContext) {
  const initiator = ctx.session.auth.initiator;
  return initiator ? scopeFromPrincipal(initiator) : undefined;
}

function logTraceFailure(sessionId: string, cause: unknown) {
  console.warn("[browser-trace] telemetry write failed", { cause, sessionId });
}

async function sweepLiveBrowserDomains(scope: AccessScope, sessionId: string) {
  const browsers = await traceTelemetryDependencies.listWorkerBrowserSessions(
    scope,
    sessionId
  );
  await Promise.all(
    browsers.map((browser) =>
      traceTelemetryDependencies.harvestBrowserTraceDomains(
        scope,
        sessionId,
        browser
      )
    )
  );
}

async function finishTrace(
  ctx: HookContext,
  emittedAt: string,
  outcome: {
    resultMessage?: string;
    status: "success" | "failure" | "error" | "cancelled";
  }
) {
  const scope = traceScope(ctx);
  if (!scope) return;
  await traceTelemetryDependencies.completeBrowserTrace(scope, ctx.session.id, {
    completedAt: emittedAt,
    resultMessage: outcome.resultMessage,
    status: outcome.status,
  });
  await sweepLiveBrowserDomains(scope, ctx.session.id);
}

export default defineHook({
  events: {
    async "*"(event, ctx) {
      try {
        const scope = traceScope(ctx);
        if (!scope) return;
        await traceTelemetryDependencies.recordBrowserTraceEvents(
          scope,
          ctx.session.id,
          traceTimelineRows(event)
        );
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
    async "message.received"(event, ctx) {
      try {
        const scope = traceScope(ctx);
        if (!scope) return;
        await traceTelemetryDependencies.beginBrowserTrace(scope, {
          sessionId: ctx.session.id,
          startedAt: event.meta.at,
          task: event.data.message,
        });
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
    async "result.completed"(event, ctx) {
      try {
        const completion = taskCompletionOutputSchema.safeParse(
          event.data.result
        );
        if (!completion.success) return;
        await finishTrace(ctx, event.meta.at, {
          resultMessage: completion.data.message,
          status: completion.data.status,
        });
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
    async "turn.failed"(event, ctx) {
      try {
        await finishTrace(ctx, event.meta.at, {
          resultMessage: event.data.message,
          status: "error",
        });
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
    async "turn.cancelled"(event, ctx) {
      try {
        await finishTrace(ctx, event.meta.at, { status: "cancelled" });
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
    async "session.failed"(event, ctx) {
      try {
        await finishTrace(ctx, event.meta.at, { status: "error" });
      } catch (error) {
        logTraceFailure(ctx.session.id, error);
      }
    },
  },
});

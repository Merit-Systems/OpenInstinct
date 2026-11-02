import { openInteractions, reply } from "eve/events";
import { defineHook } from "eve/hooks";
import { startedBrowserTaskId } from "@agent/lib/browser-task";
import { contentText } from "@agent/lib/content-text";
import { scheduledRunIdentity } from "@agent/lib/schedules/identity";
import { scheduledRunOutcomeSchema } from "@shared/schedules/outcome";
import {
  completeScheduledAgentRun,
  deferScheduledAgentRunCompletion,
  markScheduledAgentRunStarted,
  releaseScheduledAgentRun,
  waitForScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";

const workerRuntimeLimitMs = 6 * 60 * 60_000;

export default defineHook({
  events: {
    async "turn.started"(_event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const started = await markScheduledAgentRunStarted(
        identity.runId,
        identity.leaseToken,
        ctx.session.id,
        workerRuntimeLimitMs,
        ctx.now
      );
      if (!started) {
        console.warn("[scheduled-run] worker started with a stale lease", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      console.info("[scheduled-run] worker turn started", {
        runId: identity.runId,
        sessionId: ctx.session.id,
      });
    },
    async "turn.paused"(_event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      // Sign-ins complete through their own callback and take no text answer.
      const requests = openInteractions(ctx.view).filter(
        ({ request }) => request.kind !== "sign-in"
      );
      if (requests.length === 0) return;
      const waiting = await waitForScheduledAgentRunInput(
        identity.runId,
        identity.leaseToken,
        requests,
        ctx.now
      );
      if (waiting?.reportStatus !== "pending") {
        console.warn("[scheduled-run] input request missed its active lease", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      console.info("[scheduled-run] worker waiting for input", {
        requestCount: requests.length,
        runId: waiting.id,
        sessionId: ctx.session.id,
      });
      console.info("[scheduled-run] input report queued", {
        runId: waiting.id,
        sessionId: ctx.session.id,
      });
    },
    async "call.started"(event, ctx) {
      const taskId = startedBrowserTaskId(event, ctx.view);
      if (!taskId) return;
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const turnId = event.scope?.turnId ?? ctx.session.turn.id;
      const deferred = await deferScheduledAgentRunCompletion(
        identity.runId,
        identity.leaseToken,
        turnId,
        ctx.now
      );
      console.info("[scheduled-run] worker delegated background work", {
        deferred,
        runId: identity.runId,
        sessionId: ctx.session.id,
        taskId,
        turnId,
      });
    },
    async "turn.settled"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      if (event.data.outcome !== "completed") {
        const status = await releaseScheduledAgentRun(
          identity.runId,
          identity.leaseToken,
          event.data.outcome === "cancelled"
            ? "Scheduled worker was cancelled."
            : (event.data.error?.message ??
                "The scheduled worker turn failed."),
          ctx.now
        );
        console.warn(`[scheduled-run] worker turn ${event.data.outcome}`, {
          nextStatus: status,
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        logDeadLetterReportQueued(status, identity.runId, ctx.session.id);
        return;
      }
      const replyParts = reply(ctx.view, event.data.turnId).filter(
        (part) => part.kind === "text"
      );
      if (replyParts.some((part) => part.interrupted)) {
        const status = await releaseScheduledAgentRun(
          identity.runId,
          identity.leaseToken,
          "Scheduled worker stopped before finishing its reply.",
          ctx.now
        );
        console.warn("[scheduled-run] worker stopped without a final result", {
          nextStatus: status,
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        logDeadLetterReportQueued(status, identity.runId, ctx.session.id);
        return;
      }
      const message = contentText(replyParts).trim().slice(0, 4_000);
      const outcome = scheduledRunOutcomeSchema.parse(
        message
          ? {
              kind: "result",
              summary: message,
              urgency: "normal",
            }
          : {
              kind: "nothing_to_report",
              reason: "The scheduled task produced no useful update.",
            }
      );
      const completed = await completeScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.turnId,
        outcome,
        ctx.now
      );
      if (completed?.status === "deferred") {
        console.info(
          "[scheduled-run] worker completion deferred for background work",
          {
            runId: identity.runId,
            sessionId: ctx.session.id,
            turnId: event.data.turnId,
          }
        );
        return;
      }
      if (!completed) {
        console.warn("[scheduled-run] worker completion missed its lease", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      console.info("[scheduled-run] worker completed", {
        outcomeKind: outcome.kind,
        reportStatus: completed.run.reportStatus,
        runId: completed.run.id,
        sessionId: ctx.session.id,
      });
      if (completed.run.reportStatus === "pending") {
        console.info("[scheduled-run] completion report queued", {
          runId: completed.run.id,
          sessionId: ctx.session.id,
        });
      }
    },
    async "session.ended"(event, ctx) {
      if (event.data.outcome !== "failed") return;
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const status = await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.error?.message ?? "The scheduled worker session failed.",
        ctx.now
      );
      console.warn("[scheduled-run] worker session failed", {
        nextStatus: status,
        runId: identity.runId,
        sessionId: ctx.session.id,
      });
      logDeadLetterReportQueued(status, identity.runId, ctx.session.id);
    },
  },
});

function logDeadLetterReportQueued(
  status: Awaited<ReturnType<typeof releaseScheduledAgentRun>>,
  runId: string,
  sessionId: string
) {
  if (status !== "dead_letter") return;
  console.info("[scheduled-run] dead-letter report queued", {
    runId,
    sessionId,
  });
}

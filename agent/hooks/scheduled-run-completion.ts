import { defineHook } from "eve/hooks";
import { scheduledRunIdentity } from "@/agent/lib/schedules/identity";
import { scheduledRunOutcomeSchema } from "@/agent/lib/schedules/outcome";
import { postScheduledReport } from "@/agent/lib/schedules/request";
import {
  completeScheduledAgentRun,
  markScheduledAgentRunStarted,
  releaseScheduledAgentRun,
  waitForScheduledAgentRunInput,
} from "@/db/services/scheduled-agent-jobs";

const workerRuntimeLimitMs = 6 * 60 * 60_000;

export default defineHook({
  events: {
    async "turn.started"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const started = await markScheduledAgentRunStarted(
        identity.runId,
        identity.leaseToken,
        ctx.session.id,
        workerRuntimeLimitMs,
        new Date(event.meta.at)
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
    async "input.requested"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const waiting = await waitForScheduledAgentRunInput(
        identity.runId,
        identity.leaseToken,
        event.data.requests,
        new Date(event.meta.at)
      );
      if (waiting?.reportStatus !== "pending") {
        console.warn("[scheduled-run] input request missed its active lease", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      console.info("[scheduled-run] worker waiting for input", {
        requestCount: event.data.requests.length,
        runId: waiting.id,
        sessionId: ctx.session.id,
      });
      try {
        await postScheduledReport(waiting.id);
        console.info("[scheduled-run] input report callback accepted", {
          runId: waiting.id,
          sessionId: ctx.session.id,
        });
      } catch (error) {
        console.warn("[scheduled-run] input report callback failed", {
          cause: error,
          runId: waiting.id,
        });
      }
    },
    async "result.completed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const outcome = scheduledRunOutcomeSchema.safeParse(event.data.result);
      if (!outcome.success) {
        console.warn("[scheduled-run] worker returned an invalid outcome", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      const completed = await completeScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        outcome.data,
        new Date(event.meta.at)
      );
      if (!completed) {
        console.warn("[scheduled-run] worker completion missed its lease", {
          runId: identity.runId,
          sessionId: ctx.session.id,
        });
        return;
      }
      console.info("[scheduled-run] worker completed", {
        outcomeKind: outcome.data.kind,
        reportStatus: completed.reportStatus,
        runId: completed.id,
        sessionId: ctx.session.id,
      });
      if (completed.reportStatus !== "pending") return;
      try {
        await postScheduledReport(completed.id);
        console.info("[scheduled-run] completion report callback accepted", {
          runId: completed.id,
          sessionId: ctx.session.id,
        });
      } catch (error) {
        console.warn("[scheduled-run] immediate report callback failed", {
          cause: error,
          runId: completed.id,
        });
      }
    },
    async "turn.failed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const status = await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.message,
        new Date(event.meta.at)
      );
      console.warn("[scheduled-run] worker turn failed", {
        nextStatus: status,
        runId: identity.runId,
        sessionId: ctx.session.id,
      });
      await reportDeadLetter(status, identity.runId, ctx.session.id);
    },
    async "turn.cancelled"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const status = await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        "Scheduled worker was cancelled.",
        new Date(event.meta.at)
      );
      console.warn("[scheduled-run] worker turn cancelled", {
        nextStatus: status,
        runId: identity.runId,
        sessionId: ctx.session.id,
      });
      await reportDeadLetter(status, identity.runId, ctx.session.id);
    },
    async "session.failed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx.session.auth);
      if (!identity) return;
      const status = await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.message,
        new Date(event.meta.at)
      );
      console.warn("[scheduled-run] worker session failed", {
        nextStatus: status,
        runId: identity.runId,
        sessionId: ctx.session.id,
      });
      await reportDeadLetter(status, identity.runId, ctx.session.id);
    },
  },
});

async function reportDeadLetter(
  status: Awaited<ReturnType<typeof releaseScheduledAgentRun>>,
  runId: string,
  sessionId: string
) {
  if (status !== "dead_letter") return;
  try {
    await postScheduledReport(runId);
    console.info("[scheduled-run] dead-letter report callback accepted", {
      runId,
      sessionId,
    });
  } catch (error) {
    console.warn("[scheduled-run] dead-letter report callback failed", {
      cause: error,
      runId,
      sessionId,
    });
  }
}

import { defineHook } from "eve/hooks";
import type { HookContext } from "eve/hooks";
import { z } from "zod";
import { scheduledRunOutcomeSchema } from "@/agent/lib/schedules/outcome";
import {
  completeScheduledAgentRun,
  releaseScheduledAgentRun,
  waitForScheduledAgentRunInput,
} from "@/db/services/scheduled-agent-jobs";
import { postScheduledReport } from "@/agent/lib/schedules/request";

const scheduledWorker = "scheduled-worker";
const scheduledRunIdentitySchema = z.object({
  scheduledRunId: z.uuid(),
  scheduledRunLeaseToken: z.uuid(),
});

function scheduledRunIdentity(ctx: HookContext) {
  const caller =
    ctx.session.auth.initiator?.authenticator === scheduledWorker
      ? ctx.session.auth.initiator
      : ctx.session.auth.current;
  if (caller?.authenticator !== scheduledWorker) return undefined;
  const identity = scheduledRunIdentitySchema.safeParse(caller.attributes);
  return identity.success
    ? {
        leaseToken: identity.data.scheduledRunLeaseToken,
        runId: identity.data.scheduledRunId,
      }
    : undefined;
}

export default defineHook({
  events: {
    async "input.requested"(event, ctx) {
      const identity = scheduledRunIdentity(ctx);
      if (!identity) return;
      const waiting = await waitForScheduledAgentRunInput(
        identity.runId,
        identity.leaseToken,
        event.data.requests,
        new Date(event.meta.at)
      );
      if (waiting?.reportStatus !== "pending") return;
      try {
        await requestImmediateReport(waiting.id);
      } catch (error) {
        console.warn("[scheduled-run] input report callback failed", {
          cause: error,
          runId: waiting.id,
        });
      }
    },
    async "result.completed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx);
      if (!identity) return;
      const outcome = scheduledRunOutcomeSchema.safeParse(event.data.result);
      if (!outcome.success) return;
      const completed = await completeScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        outcome.data,
        new Date(event.meta.at)
      );
      if (completed?.reportStatus !== "pending") return;
      try {
        await postScheduledReport(completed.id);
      } catch (error) {
        console.warn("[scheduled-run] immediate report callback failed", {
          cause: error,
          runId: completed.id,
        });
      }
    },
    async "turn.failed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx);
      if (!identity) return;
      await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.message,
        new Date(event.meta.at)
      );
    },
    async "turn.cancelled"(event, ctx) {
      const identity = scheduledRunIdentity(ctx);
      if (!identity) return;
      await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        "Scheduled worker was cancelled.",
        new Date(event.meta.at)
      );
    },
    async "session.failed"(event, ctx) {
      const identity = scheduledRunIdentity(ctx);
      if (!identity) return;
      await releaseScheduledAgentRun(
        identity.runId,
        identity.leaseToken,
        event.data.message,
        new Date(event.meta.at)
      );
    },
  },
});

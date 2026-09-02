import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@/agent/lib/mode";
import { scheduledReportIdentity } from "@/agent/lib/schedules/identity";
import { scheduleOwner } from "@/agent/lib/schedules/tools";
import {
  getScheduledAgentRunInput,
  getScheduledAgentRunInputForReport,
} from "@/db/services/scheduled-agent-jobs";
import { applicationOrigin } from "@/lib/application-origin";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const answerSchedule = defineTool({
        description:
          "Resume a scheduled task that is waiting for input. During scheduled reporting, use existing conversation context when it clearly answers the request. During an interactive turn, pass the user's answer exactly as given.",
        inputSchema: z.strictObject({
          answer: z.string().trim().min(1).max(8_000),
          runId: z.uuid(),
        }),
        async execute({ answer, runId }, toolContext) {
          const pending = await pendingScheduledRun(toolContext, runId);
          if (!pending) {
            throw new Error("That scheduled task is not waiting for input.");
          }
          const response = await fetch(
            new URL("/internal/scheduled-run/respond", applicationOrigin()),
            {
              body: JSON.stringify({
                answer,
                leaseToken: pending.leaseToken,
                runId: pending.runId,
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            }
          );
          if (!response.ok) {
            throw new Error(
              response.status === 422
                ? "That answer does not match the pending choices."
                : "The scheduled task could not be resumed."
            );
          }
          return { resumed: true, runId };
        },
      });
      return resolveModeValue(context, {
        interactive: answerSchedule,
        "scheduled-report": answerSchedule,
      });
    },
  },
});

async function pendingScheduledRun(context: ToolContext, runId: string) {
  const resolvePending = resolveModeValue(context, {
    interactive: () => {
      const owner = scheduleOwner(context);
      return getScheduledAgentRunInput(owner.scope, owner.linqThreadId, runId);
    },
    "scheduled-report": () => {
      const report = scheduledReportIdentity(context.session.auth);
      if (!report || report.runId !== runId) {
        throw new Error("This reporting turn cannot resume that run.");
      }
      return getScheduledAgentRunInputForReport(
        report.runId,
        report.leaseToken
      );
    },
  });
  return resolvePending?.();
}

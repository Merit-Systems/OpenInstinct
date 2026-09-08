import type { SessionContext } from "eve/context";
import type { ScheduleToFn } from "eve/schedules";
import { z } from "zod";
import linq from "@agent/channels/linq";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import {
  finishConversationWakeup,
  isConversationWakeupCurrent,
} from "@db/services/conversation-wakeups";
import type { claimReadyScheduledAgentRuns } from "@db/services/scheduled-agent-jobs";

const wakeupSchema = z.object({
  scheduleId: z.uuid(),
  scheduleRevision: z.coerce.number().int().nonnegative(),
  conversationId: z.string().startsWith("linq:"),
});

export async function assertCurrentWakeup(
  auth: SessionContext["session"]["auth"]
) {
  const caller = auth.current;
  if (caller?.authenticator !== "scheduled-wakeup") return;
  const attributes = wakeupSchema.parse(caller.attributes);
  if (
    !(await isConversationWakeupCurrent(
      scopeFromPrincipal(caller),
      attributes.scheduleId,
      attributes.scheduleRevision,
      attributes.conversationId
    ))
  ) {
    throw new Error("This check-in was stopped because its schedule changed.");
  }
}

export async function dispatchConversationWakeup(
  to: ScheduleToFn,
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number]
) {
  const scope = {
    userId: claim.job.createdByUserId,
    workspaceId: claim.job.workspaceId,
  };
  try {
    if (
      !(await isConversationWakeupCurrent(
        scope,
        claim.job.id,
        claim.job.revision,
        claim.job.conversationId
      ))
    ) {
      await finishConversationWakeup(
        claim,
        "The check-in schedule changed before delivery."
      );
      return;
    }
    await to(linq, {
      adapterName: "linq",
      threadId: claim.job.conversationId,
    }).send(
      [
        "This is a scheduled check-in in the main conversation, not a new user request.",
        `Scheduled for: ${claim.run.scheduledFor.toISOString()}`,
        `Task: ${claim.job.prompt}`,
        "Use the conversation and your normal capabilities. Existing approval requirements still apply. Do not acknowledge this wake-up, send a routine status message, or react to an old user message. Remain silent unless there is something worth telling the user. Do not change this schedule unless the user requested it.",
      ].join("\n\n"),
      {
        auth: {
          authenticator: "scheduled-wakeup",
          issuer: "open-instinct",
          principalType: "user",
          principalId: scope.userId,
          attributes: {
            workspaceId: scope.workspaceId,
            conversationChannel: "linq",
            conversationId: claim.job.conversationId,
            scheduleId: claim.job.id,
            scheduleRevision: String(claim.job.revision),
          },
        },
        turnPolicy: "queue",
      }
    );
    await finishConversationWakeup(claim);
  } catch (error) {
    await finishConversationWakeup(
      claim,
      error instanceof Error ? error.message : "Wake-up delivery failed."
    );
  }
}

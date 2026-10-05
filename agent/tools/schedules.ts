import { postScheduledRunRoute } from "@db/services/auth/scheduled-requests";
import { createHash } from "node:crypto";
import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@agent/lib/mode";
import { scheduledReportIdentity } from "@agent/lib/schedules/identity";
import { performScheduledCommand } from "@agent/lib/schedules/request";
import {
  scheduleListSummary,
  scheduleOwner,
  scheduleReplyAnchor,
} from "@agent/lib/schedules/tools";
import { scheduleTimingSchema } from "@shared/schedules/timing";
import {
  getScheduledAgentJob,
  getScheduledAgentRunInput,
  getScheduledAgentRunInputForReport,
  listScheduledAgentJobs,
} from "@db/services/scheduled-agent-jobs";

export const createSchedule = defineTool({
  description:
    "Create a one-time, fixed-interval, or timezone-aware calendar job for this conversation. Use calendar timing for human wall-clock recurrence so it remains stable across daylight saving time. Summarize the exact requested work in prompt.",
  inputSchema: z.object({
    missedRunPolicy: z.enum(["run_latest", "catch_up"]).default("run_latest"),
    prompt: z.string().trim().min(1).max(8_000),
    timing: scheduleTimingSchema,
  }),
  async execute(input, context) {
    const owner = scheduleOwner(context);
    const result = await performScheduledCommand({
      kind: "create",
      ...owner,
      at: new Date().toISOString(),
      input: {
        ...input,
        id: scheduledMutationId(context),
        replyAnchorMessageId: scheduleReplyAnchor(context),
      },
    });
    if (!result.job) throw new Error("The schedule could not be created.");
    return result.job;
  },
});

export const listSchedules = defineTool({
  description:
    "List the authenticated user's one-time and recurring jobs for this conversation. Use this before changing a schedule when the target is ambiguous.",
  inputSchema: z.object({}),
  async execute(_input, context) {
    const owner = scheduleOwner(context);
    return (await listScheduledAgentJobs(owner.scope, owner.conversation)).map(
      scheduleListSummary
    );
  },
});

const updateScheduleInputSchema = z
  .object({
    id: z.uuid(),
    prompt: z.string().trim().min(1).max(8_000).optional(),
    status: z.enum(["active", "paused", "deleted"]).optional(),
    timing: scheduleTimingSchema.optional(),
  })
  .refine(
    ({ prompt, status, timing }) =>
      prompt !== undefined || status !== undefined || timing !== undefined,
    { message: "Provide at least one schedule change." }
  );

export const updateSchedule = defineTool({
  description:
    "Update, pause, resume, or delete one of the authenticated user's scheduled jobs. Set status paused or active to pause or resume it. List schedules first when the target is ambiguous.",
  inputSchema: updateScheduleInputSchema,
  async execute({ id, ...patch }, context) {
    const owner = scheduleOwner(context);
    const current = await getScheduledAgentJob(
      owner.scope,
      owner.conversation,
      id
    );
    if (!current || current.status === "deleted")
      throw new Error("Schedule not found.");
    const result = await performScheduledCommand({
      kind: "update",
      ...owner,
      at: new Date().toISOString(),
      id,
      patch,
      expectedRevision: current.revision,
      mutationId: scheduledMutationId(context),
    });
    if (!result.job)
      throw new Error(
        "The schedule changed before this update. List schedules and try again."
      );
    return result.job;
  },
});

export const answerSchedule = defineTool({
  description:
    "Resume a scheduled task that is waiting for input. During scheduled reporting, use existing conversation context when it clearly answers the request. During an interactive turn, pass the user's answer exactly as given.",
  inputSchema: z.strictObject({
    answer: z.string().trim().min(1).max(8_000),
    runId: z.uuid(),
  }),
  async execute({ answer, runId }, context) {
    const pending = await pendingScheduledRun(context, runId);
    if (!pending) {
      throw new Error("That scheduled task is not waiting for input.");
    }
    const response = await postScheduledRunRoute(
      "/internal/scheduled-run/respond",
      {
        answer,
        leaseToken: pending.leaseToken,
        runId: pending.runId,
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

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: {
          "schedules-answer": answerSchedule,
          "schedules-create": createSchedule,
          "schedules-list": listSchedules,
          "schedules-update": updateSchedule,
        },
        "scheduled-report": { "schedules-answer": answerSchedule },
      }),
  },
});

async function pendingScheduledRun(context: ToolContext, runId: string) {
  const resolvePending = resolveModeValue(context, {
    interactive: () => {
      const owner = scheduleOwner(context);
      return getScheduledAgentRunInput(owner.scope, owner.conversation, runId);
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

function scheduledMutationId(context: ToolContext) {
  const bytes = createHash("sha256")
    .update(context.session.id + ":" + context.callId)
    .digest();
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

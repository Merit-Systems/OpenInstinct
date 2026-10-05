import { isInputRequest, type InputRequest } from "eve/client";
import { z } from "zod";
import { scheduleTimingSchema } from "./timing";
import { scheduledRunOutcomeSchema } from "./outcome";

const instant = z.iso.datetime();
const conversation = z.strictObject({
  conversationChannel: z.enum(["eve", "linq"]),
  conversationId: z.string().min(1),
});
const scope = z.strictObject({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
});
const runIdentity = { runId: z.uuid(), leaseToken: z.uuid(), at: instant };

export const scheduledWakeupSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("legacy-run"),
    runId: z.uuid(),
    at: instant,
    deadline: instant,
  }),
  z.strictObject({
    kind: z.literal("job"),
    jobId: z.uuid(),
    revision: z.number().int().nonnegative(),
    at: instant,
  }),
  z.strictObject({
    kind: z.literal("run"),
    runId: z.uuid(),
    attempts: z.number().int().nonnegative(),
    leaseToken: z.uuid().nullable(),
    at: instant,
  }),
  z.strictObject({
    kind: z.literal("report"),
    runId: z.uuid(),
    sequence: z.number().int().positive(),
    leaseToken: z.uuid().nullable(),
    at: instant,
  }),
]);
export type ScheduledWakeup = z.infer<typeof scheduledWakeupSchema>;

export const scheduledCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observe"), runId: z.uuid(), at: instant }),
  z.strictObject({
    kind: z.literal("create"),
    scope,
    conversation,
    at: instant,
    input: z.strictObject({
      id: z.uuid(),
      prompt: z.string().trim().min(1).max(8_000),
      timing: scheduleTimingSchema,
      missedRunPolicy: z.enum(["run_latest", "catch_up"]),
      replyAnchorMessageId: z.string().min(1).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("update"),
    scope,
    conversation,
    at: instant,
    id: z.uuid(),
    mutationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    patch: z.strictObject({
      prompt: z.string().trim().min(1).max(8_000).optional(),
      timing: scheduleTimingSchema.optional(),
      status: z.enum(["active", "paused", "deleted"]).optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("input"),
    ...runIdentity,
    requests: z.array(z.custom<InputRequest>(isInputRequest)).min(1),
  }),
  z.strictObject({
    kind: z.literal("complete"),
    ...runIdentity,
    turnId: z.string().min(1),
    outcome: scheduledRunOutcomeSchema,
  }),
  z.strictObject({
    kind: z.literal("release"),
    ...runIdentity,
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal("release-report"),
    ...runIdentity,
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal("backfill"),
    cursor: z.string().optional(),
  }),
]);
export type ScheduledCommand = z.infer<typeof scheduledCommandSchema>;

export const scheduledResponseSchema = z.strictObject({
  wakeups: z.array(scheduledWakeupSchema),
  result: z
    .strictObject({
      job: z
        .strictObject({
          createdAt: instant,
          id: z.uuid(),
          lastError: z.string().nullable(),
          lastRunAt: instant.nullable(),
          nextRunAt: instant.nullable(),
          prompt: z.string(),
          status: z.enum(["active", "paused", "completed", "deleted"]),
          timing: scheduleTimingSchema,
        })
        .optional(),
      status: z.enum(["completed", "deferred", "stale"]).optional(),
      reportStatus: z.string().optional(),
      nextStatus: z.enum(["queued", "dead_letter"]).optional(),
      cursor: z.string().nullable().optional(),
    })
    .default({}),
});

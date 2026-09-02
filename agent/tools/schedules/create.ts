import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@/agent/lib/mode";
import { scheduleOwner, scheduleSummary } from "@/agent/lib/schedules/tools";
import { scheduleTimingSchema } from "@/agent/lib/schedules/timing";
import { createScheduledAgentJob } from "@/db/services/scheduled-agent-jobs";

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
    return scheduleSummary(
      await createScheduledAgentJob(owner.scope, {
        ...owner.conversation,
        missedRunPolicy: input.missedRunPolicy,
        prompt: input.prompt,
        timing: input.timing,
      })
    );
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: createSchedule }),
  },
});

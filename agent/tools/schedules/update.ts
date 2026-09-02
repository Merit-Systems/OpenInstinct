import { defineTool } from "eve/tools";
import { z } from "zod";
import { scheduleOwner, scheduleSummary } from "@/agent/lib/schedules/tools";
import { scheduleTimingSchema } from "@/agent/lib/schedules/timing";
import { updateScheduledAgentJob } from "@/db/services/scheduled-agent-jobs";

const inputSchema = z
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

export default defineTool({
  description:
    "Update, pause, resume, or delete one of the authenticated user's scheduled jobs. Set status paused or active to pause or resume it. List schedules first when the target is ambiguous.",
  inputSchema,
  async execute({ id, ...patch }, context) {
    const owner = scheduleOwner(context);
    const job = await updateScheduledAgentJob(
      owner.scope,
      owner.linqThreadId,
      id,
      patch
    );
    if (!job) throw new Error("Schedule not found.");
    return scheduleSummary(job);
  },
});

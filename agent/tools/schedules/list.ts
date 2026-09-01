import { defineTool } from "eve/tools";
import { z } from "zod";
import { scheduleOwner, scheduleSummary } from "@/agent/lib/schedules/tools";
import { listScheduledAgentJobs } from "@/db/services/scheduled-agent-jobs";

export default defineTool({
  description:
    "List the authenticated user's one-time and recurring jobs for this iMessage conversation. Use this before changing a schedule when the target is ambiguous.",
  inputSchema: z.object({}),
  async execute(_input, context) {
    const owner = scheduleOwner(context);
    return (await listScheduledAgentJobs(owner.scope)).map(scheduleSummary);
  },
});

import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@/agent/lib/mode";
import { scheduleOwner, scheduleSummary } from "@/agent/lib/schedules/tools";
import { listScheduledAgentJobs } from "@/db/services/scheduled-agent-jobs";

export const listSchedules = defineTool({
  description:
    "List the authenticated user's one-time and recurring jobs for this conversation. Use this before changing a schedule when the target is ambiguous.",
  inputSchema: z.object({}),
  async execute(_input, context) {
    const owner = scheduleOwner(context);
    return (await listScheduledAgentJobs(owner.scope, owner.conversation)).map(
      scheduleSummary
    );
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: listSchedules }),
  },
});

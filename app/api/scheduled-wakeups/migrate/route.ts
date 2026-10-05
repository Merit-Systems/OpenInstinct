import { start } from "workflow/api";
import { authorizeScheduledBackfillRequest } from "@db/services/auth/scheduled-requests";
import { scheduledWakeupOrigin } from "@shared/environment/scheduled-origin";
import { scheduledResponseSchema } from "@shared/schedules/wakeups";
import { scheduledCommandWorkflow } from "../workflows";

export async function POST(request: Request) {
  const denied = await authorizeScheduledBackfillRequest(request);
  if (denied) return denied;
  const run = await start(scheduledCommandWorkflow, [
    { kind: "backfill" },
    await scheduledWakeupOrigin(),
  ]);
  return Response.json(scheduledResponseSchema.parse(await run.returnValue));
}

import { start } from "workflow/api";
import { authorizeScheduledRequest } from "@db/services/auth/scheduled-requests";
import { scheduledWakeupOrigin } from "@shared/environment/scheduled-origin";
import {
  scheduledCommandSchema,
  scheduledResponseSchema,
} from "@shared/schedules/wakeups";
import { scheduledCommandWorkflow } from "./workflows";

export async function POST(request: Request) {
  const denied = await authorizeScheduledRequest(request);
  if (denied) return denied;
  const command = scheduledCommandSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!command.success) return new Response(null, { status: 400 });
  const run = await start(scheduledCommandWorkflow, [
    command.data,
    await scheduledWakeupOrigin(),
  ]);
  return Response.json(scheduledResponseSchema.parse(await run.returnValue));
}

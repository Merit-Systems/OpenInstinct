import { postScheduledRunRoute } from "@db/services/auth/scheduled-requests";
import {
  scheduledResponseSchema,
  type ScheduledCommand,
} from "@shared/schedules/wakeups";

export async function postScheduledReport(runId: string) {
  const response = await postScheduledRunRoute(
    "/internal/scheduled-run/report",
    { runId }
  );
  if (!response.ok) {
    throw new Error(
      `Scheduled report callback failed (${String(response.status)}).`
    );
  }
}

export async function performScheduledCommand(command: ScheduledCommand) {
  const response = await postScheduledRunRoute(
    "/api/scheduled-wakeups",
    command
  );
  if (!response.ok)
    throw new Error(
      "Scheduled operation failed (" + String(response.status) + ")."
    );
  return scheduledResponseSchema.parse(await response.json()).result;
}

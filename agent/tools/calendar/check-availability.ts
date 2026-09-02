import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { checkCalendarAvailability } from "@/agent/lib/google-workspace/calendar";
import { resolveModeValue } from "@/agent/lib/mode";

export const calendarCheckAvailability = defineTool({
  description:
    "Check free and busy periods for selected Google calendars in an exact time range.",
  inputSchema: z.object({
    calendars: z.array(z.string()).min(1).max(10).default(["primary"]),
    timeMax: z.iso.datetime({ offset: true }),
    timeMin: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1).default("UTC"),
  }),
  execute(input, ctx) {
    return checkCalendarAvailability(ctx, input);
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: calendarCheckAvailability,
        "scheduled-worker": calendarCheckAvailability,
      }),
  },
});

import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import {
  calendarEventSchema,
  createCalendarEvent,
} from "@/agent/lib/google-workspace/calendar";
import { resolveModeValue } from "@/agent/lib/mode";

export const calendarCreateEvent = defineTool({
  approval: always(),
  description:
    "Create a confirmed private Google Calendar event. This requires user approval and sends updates to attendees.",
  inputSchema: calendarEventSchema,
  async execute(input, ctx) {
    return {
      created: true,
      event: await createCalendarEvent(ctx, input),
    };
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: calendarCreateEvent }),
  },
});

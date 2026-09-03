import type { EveDynamicToolPart } from "eve/react";
import { z } from "zod";

const emailSchema = z.object({
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  to: z.array(z.string()),
});
const calendarEventSchema = z.object({
  attendees: z.array(z.string()).default([]),
  calendarId: z.string().default("primary"),
  start: z.string(),
  summary: z.string(),
});
const gmailUpdateSchema = z.object({
  messageIds: z.array(z.string()),
  update: z.string(),
});

/**
 * One readable sentence naming the consequential fields of a tool call that is
 * waiting for approval, so the approver never decides from the tool name alone.
 */
export function approvalSummary({
  input,
  toolName,
}: Pick<EveDynamicToolPart, "input" | "toolName">) {
  switch (toolName) {
    case "gmail-send": {
      const email = emailSchema.safeParse(input).data;
      if (!email) return undefined;
      const cc = email.cc.length > 0 ? ` (cc ${email.cc.join(", ")})` : "";
      return `Send email to ${email.to.join(", ")}${cc} with subject “${email.subject}”.`;
    }
    case "calendar-create-event": {
      const event = calendarEventSchema.safeParse(input).data;
      if (!event) return undefined;
      const attendees =
        event.attendees.length > 0
          ? ` and invite ${String(event.attendees.length)} attendee${event.attendees.length === 1 ? "" : "s"} (${event.attendees.join(", ")})`
          : "";
      return `Create “${event.summary}” on calendar ${event.calendarId} starting ${event.start}${attendees}.`;
    }
    case "gmail-update": {
      const update = gmailUpdateSchema.safeParse(input).data;
      if (!update) return undefined;
      return `Apply “${update.update}” to ${String(update.messageIds.length)} message${update.messageIds.length === 1 ? "" : "s"}.`;
    }
    default:
      return undefined;
  }
}

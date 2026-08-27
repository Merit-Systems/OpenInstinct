import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  calendarEventSchema,
  createCalendarEvent,
} from "@/agent/lib/google-workspace/calendar";
import {
  GMAIL_UPDATE_ACTIONS,
  gmailSendSchema,
  sendGmail,
  updateGmail,
} from "@/agent/lib/google-workspace/gmail";

const updateEmailSchema = z.object({
  action: z.literal("update_email"),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  update: z.enum(GMAIL_UPDATE_ACTIONS),
});
const sendEmailSchema = gmailSendSchema.extend({
  action: z.literal("send_email"),
});
const createCalendarEventSchema = calendarEventSchema.extend({
  action: z.literal("create_calendar_event"),
});

export const googleWorkspaceWriteInputSchema = z.object({
  action: z.enum(["update_email", "send_email", "create_calendar_event"]),
  attendees: z.array(z.email()).max(50).optional(),
  bcc: z.array(z.email()).max(20).optional(),
  body: z.string().min(1).max(100_000).optional(),
  calendarId: z.string().optional(),
  cc: z.array(z.email()).max(20).optional(),
  description: z.string().max(8_000).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  inReplyTo: z.string().max(998).optional(),
  location: z.string().max(1_000).optional(),
  messageIds: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  subject: z.string().min(1).max(998).optional(),
  summary: z.string().min(1).max(1_000).optional(),
  threadId: z.string().max(200).optional(),
  timezone: z.string().min(1).optional(),
  to: z.array(z.email()).min(1).max(20).optional(),
  update: z.enum(GMAIL_UPDATE_ACTIONS).optional(),
});

type GoogleWorkspaceWriteAction = z.infer<
  typeof googleWorkspaceWriteInputSchema
>["action"];

export function googleWorkspaceWriteApproval(
  action: GoogleWorkspaceWriteAction | undefined
) {
  return action === "update_email" ? "not-applicable" : "user-approval";
}

export default defineTool({
  approval: ({ toolInput }) => googleWorkspaceWriteApproval(toolInput?.action),
  description:
    "Change the authenticated user's Google Workspace. Reversible Gmail label updates act on exact message IDs. Sending email or creating a confirmed calendar event requires user approval. This tool cannot delete mail, change account settings, or edit contacts.",
  inputSchema: googleWorkspaceWriteInputSchema,
  async execute(input, ctx) {
    switch (input.action) {
      case "update_email": {
        const parsed = updateEmailSchema.parse(input);
        const updated = await updateGmail(
          ctx,
          parsed.messageIds,
          parsed.update
        );
        return {
          action: input.action,
          update: updated.action,
          updatedCount: updated.updatedCount,
        };
      }
      case "send_email": {
        const sent = await sendGmail(ctx, sendEmailSchema.parse(input));
        return {
          action: input.action,
          messageId: sent.id,
          sent: true,
          threadId: sent.threadId,
        };
      }
      case "create_calendar_event":
        return {
          action: input.action,
          created: true,
          event: await createCalendarEvent(
            ctx,
            createCalendarEventSchema.parse(input)
          ),
        };
    }
  },
});

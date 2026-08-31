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

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_email"),
    messageIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    update: z.enum(GMAIL_UPDATE_ACTIONS),
  }),
  gmailSendSchema.extend({ action: z.literal("send_email") }),
  calendarEventSchema.extend({ action: z.literal("create_calendar_event") }),
]);

type GoogleWorkspaceWriteAction = z.infer<typeof inputSchema>["action"];

export function googleWorkspaceWriteApproval(
  action: GoogleWorkspaceWriteAction | undefined
) {
  return action === "update_email" ? "not-applicable" : "user-approval";
}

export default defineTool({
  approval: ({ toolInput }) => googleWorkspaceWriteApproval(toolInput?.action),
  description:
    "Change the authenticated user's Google Workspace. Reversible Gmail label updates act on exact message IDs. Sending email or creating a confirmed calendar event requires user approval. This tool cannot delete mail, change account settings, or edit contacts.",
  inputSchema,
  async execute(input, ctx) {
    switch (input.action) {
      case "update_email": {
        const updated = await updateGmail(ctx, input.messageIds, input.update);
        return {
          action: input.action,
          update: updated.action,
          updatedCount: updated.updatedCount,
        };
      }
      case "send_email": {
        const sent = await sendGmail(ctx, input);
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
          event: await createCalendarEvent(ctx, input),
        };
    }
    throw new Error("Unsupported Google Workspace write action.");
  },
});

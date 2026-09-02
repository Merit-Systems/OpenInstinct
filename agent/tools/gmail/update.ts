import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  GMAIL_UPDATE_ACTIONS,
  updateGmail,
} from "@/agent/lib/google-workspace/gmail";
import { resolveModeValue } from "@/agent/lib/mode";

export const gmailUpdate = defineTool({
  description:
    "Apply one reversible Gmail state change to exact message IDs: archive, move to inbox, mark read or unread, or star or unstar.",
  inputSchema: z.object({
    messageIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    update: z.enum(GMAIL_UPDATE_ACTIONS),
  }),
  async execute(input, ctx) {
    const updated = await updateGmail(ctx, input.messageIds, input.update);
    return {
      update: updated.action,
      updatedCount: updated.updatedCount,
    };
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: gmailUpdate }),
  },
});

import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { gmailSendSchema, sendGmail } from "@/agent/lib/google-workspace/gmail";
import { resolveModeValue } from "@/agent/lib/mode";

export const gmailSend = defineTool({
  approval: always(),
  description:
    "Send an email from the authenticated user's Gmail account. This requires user approval.",
  inputSchema: gmailSendSchema,
  async execute(input, ctx) {
    const sent = await sendGmail(ctx, input);
    return {
      messageId: sent.id,
      sent: true,
      threadId: sent.threadId,
    };
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, { interactive: gmailSend }),
  },
});

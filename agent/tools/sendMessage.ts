import { defineDynamic, defineTool } from "eve/tools";
import { conversationMessageSchema } from "../../lib/conversation-message.js";

export default defineDynamic({
  events: {
    "step.started": () =>
      defineTool({
        description:
          "Send one user-visible message to the current conversation. Only the root conversational agent may call this. Use it for direct answers, questions, acknowledgements, progress updates, blockers, and final results.",
        inputSchema: conversationMessageSchema,
        outputSchema: conversationMessageSchema,
        execute(message, ctx) {
          if (ctx.session.parent) {
            throw new Error(
              "sendMessage is reserved for the root conversation. Return the result to the parent coordinator instead."
            );
          }
          return message;
        },
      }),
  },
});

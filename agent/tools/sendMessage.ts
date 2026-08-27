import { defineDynamic, defineTool } from "eve/tools";
import { conversationMessageSchema } from "@/lib/conversation-message";

export default defineDynamic({
  events: {
    "step.started": () =>
      defineTool({
        description:
          "Send one user-visible message to the current conversation. Only the root conversational agent may call this. Use it for direct answers, questions, acknowledgements, progress updates, blockers, and final results. A successful call completes that update: never repeat the same message in the same turn.",
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
        toModelOutput() {
          return {
            type: "text",
            value:
              "Message delivered. Do not call sendMessage again unless you have distinct new information for the user. End the turn without ordinary assistant text when the update is complete.",
          };
        },
      }),
  },
});

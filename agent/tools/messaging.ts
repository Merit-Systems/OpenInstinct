import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { resolveModeValue } from "../lib/mode";
import {
  addReactionToMessageOutputSchema,
  reactToMessageOutputSchema,
} from "../lib/react-to-message";
import { sendMessageOutputSchema } from "../lib/send-message";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const isLinq = context.channel.kind === "channel:linq";
      const send_message = defineTool({
        description:
          "Send exactly one user-visible message to the current conversation. This is the delivery path for questions, progress updates, blockers, and final answers that need words. Choose kind message for plain text, private image artifacts, and HTTPS attachments; text and attachments may be combined. Text is delivered exactly as written, so write it the way it should appear to the user and do not use Markdown. Choose kind link with a URL to send a standalone link, rendered as a native Linq preview where supported. Put an ordinary URL in message text when a preview is not wanted. Call send_message multiple times only when you intentionally want separate messages. Call it directly without an assistant-text preamble, and do not repeat delivered content afterward.",
        inputSchema: sendMessageOutputSchema,
        execute(message) {
          return message;
        },
        toModelOutput() {
          return toolOutput.text(
            "The message was submitted to the active channel. Do not repeat it in assistant text."
          );
        },
      });

      const react_to_message = defineTool({
        description: isLinq
          ? "Add or remove a native iMessage Tapback on the user's current message. Use this instead of send_message when a reaction fully communicates a lightweight acknowledgement and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question."
          : "Acknowledge the user's current message with one compact reaction displayed in the conversation. Use this instead of send_message when the reaction fully communicates the response and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question.",
        inputSchema: isLinq
          ? reactToMessageOutputSchema
          : addReactionToMessageOutputSchema,
        execute(reaction) {
          return reaction;
        },
        toModelOutput() {
          return toolOutput.text(
            "The reaction was submitted to the active conversation. Do not repeat it in assistant text."
          );
        },
      });

      const sendOnly = { send_message };
      const interactive = { react_to_message, send_message };

      return resolveModeValue(context, {
        interactive,
        "scheduled-report": sendOnly,
      });
    },
  },
});

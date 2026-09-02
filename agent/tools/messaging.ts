import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { resolveModeValue } from "../lib/mode";
import { reactToMessageOutputSchema } from "../lib/react-to-message";
import { sendMessageOutputSchema } from "../lib/send-message";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const send_message = defineTool({
        description:
          "Send exactly one user-visible message to the current iMessage conversation. This is the only delivery path for acknowledgements, questions, progress updates, blockers, and final answers. Choose kind message for plain text, private image artifacts, and HTTPS attachments; text and attachments may be combined. Text is delivered exactly as written, so write it the way it should appear on the phone and do not use Markdown. Choose kind link with a URL to send a standalone native Linq rich link-preview card. Put an ordinary URL in message text when a preview card is not wanted. Call send_message multiple times when you intentionally want separate messages. Call it directly without an assistant-text preamble, and do not repeat delivered content afterward.",
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

      const sendOnly = { send_message };
      const interactive =
        context.channel.kind === "channel:linq"
          ? {
              react_to_message: defineTool({
                description:
                  "Add or remove a native iMessage Tapback on the user's current message. Use this instead of send_message when a reaction fully communicates a lightweight acknowledgement and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question.",
                inputSchema: reactToMessageOutputSchema,
                execute(reaction) {
                  return reaction;
                },
                toModelOutput() {
                  return toolOutput.text(
                    "The reaction was submitted to the active iMessage conversation. Do not repeat it in assistant text."
                  );
                },
              }),
              send_message,
            }
          : sendOnly;

      return resolveModeValue(context, {
        interactive,
        "scheduled-report": sendOnly,
      });
    },
  },
});

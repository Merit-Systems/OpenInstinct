import { defineTool, toolOutput } from "eve/tools";
import { sendMessageOutputSchema } from "../lib/send-message";

export default defineTool({
  description:
    "Send exactly one user-visible message to the current iMessage conversation. This is the only delivery path for acknowledgements, questions, progress updates, blockers, and final answers. Choose kind message for Markdown, private image artifacts, and HTTPS attachments; Markdown and attachments may be combined. Choose kind link with a URL to send a standalone native Linq rich link-preview card. Put an ordinary URL in message Markdown when a preview card is not wanted. Call send_message multiple times when you intentionally want separate messages. Call it directly without an assistant-text preamble, and do not repeat delivered content afterward.",
  inputSchema: sendMessageOutputSchema,
  execute(message, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (caller?.authenticator === "scheduled-worker") {
      throw new Error(
        "Scheduled workers return a structured outcome instead of messaging the user."
      );
    }
    return message;
  },
  toModelOutput() {
    return toolOutput.text(
      "The message was submitted to the active channel. Do not repeat it in assistant text."
    );
  },
});

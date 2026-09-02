import { defineTool, toolOutput } from "eve/tools";
import { reactToMessageOutputSchema } from "../lib/react-to-message";

export default defineTool({
  description:
    "Add or remove a native iMessage Tapback on the user's current message. Use this instead of send_message when a reaction fully communicates a lightweight acknowledgement and words would add nothing. Supports thumbs_up, thumbs_down, heart, laugh, exclamation (emphasis), and question.",
  inputSchema: reactToMessageOutputSchema,
  execute(reaction, context) {
    const caller =
      context.session.auth.current ?? context.session.auth.initiator;
    if (caller?.authenticator === "scheduled-worker") {
      throw new Error(
        "Scheduled workers return a structured outcome instead of reacting to user messages."
      );
    }
    return reaction;
  },
  toModelOutput() {
    return toolOutput.text(
      "The reaction was submitted to the active iMessage conversation. Do not repeat it in assistant text."
    );
  },
});

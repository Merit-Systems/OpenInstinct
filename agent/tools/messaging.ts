import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { resolveModeValue } from "../lib/mode";
import {
  addReactionToMessageOutputSchema,
  reactToMessageOutputSchema,
} from "@shared/chat/reaction";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";

function defineSendMessage() {
  return defineTool({
    description:
      "Send exactly one user-visible message to the current conversation. This is the delivery path for questions, progress updates, blockers, and final answers that need words. Choose kind message for plain text, private image artifacts, and HTTPS attachments; text and attachments may be combined. Text is delivered exactly as written, so write it like a brief natural text message and do not use Markdown. Set replyTo only when a native quoted reply helps reconnect the message to its subject: current targets the current user message, task accepts a task ID from Eve's Task state, and automation accepts the automation ID supplied by a scheduled report. Prefer task or automation replies for delayed results when intervening conversation could make the subject unclear. Use current for an explicit reply request or ambiguity among multiple unaddressed messages. Do not use current merely because you are answering the latest message or continuing an ordinary exchange; omit replyTo when the message reads naturally in chronological order. Use only handles present in the current context. Replies with attachments are unsupported. Choose kind link with a URL to send a standalone native preview. Put an ordinary URL in message text when a preview is not wanted. Call send_message multiple times only when you intentionally want separate messages. Call it directly without an assistant-text preamble, and do not repeat delivered content afterward.",
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
}

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const isLinq = context.channel.kind === "channel:linq";
      const send_message = defineSendMessage();

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

      const interactive = { react_to_message, send_message };

      type MessagingTools =
        | typeof interactive
        | { send_message: typeof send_message };

      return resolveModeValue<MessagingTools>(context, {
        interactive,
        "scheduled-report": { send_message },
      });
    },
  },
});

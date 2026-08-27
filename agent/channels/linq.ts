/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { linqChannel } from "eve/channels/linq";
import { conversationMessageFromActionResult } from "../../lib/conversation-message.js";

export default linqChannel({
  credentials: connectLinqCredentials("linq/eve-kernel"),
  events: {
    async "action.result"(event, channel) {
      const message = conversationMessageFromActionResult(event.result);
      if (message && channel.thread) {
        await channel.thread.post({ markdown: message });
      }
    },
    "message.appended"() {
      return undefined;
    },
    "message.completed"() {
      return undefined;
    },
  },
});

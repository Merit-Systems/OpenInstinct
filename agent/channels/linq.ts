/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { defaultLinqAuth, linqChannel } from "eve/channels/linq";
import { accessScopeForUser } from "../../lib/access-scope.js";
import {
  claimConversationMessageRelay,
  conversationMessageFromActionResult,
} from "../../lib/conversation-message.js";

export default linqChannel({
  credentials: connectLinqCredentials("linq/eve-kernel"),
  events: {
    async "action.result"(event, channel, ctx) {
      const message = conversationMessageFromActionResult(event.result);
      if (!message || !channel.thread) return;
      if (
        !claimConversationMessageRelay(
          channel.state,
          ctx.session.turn.id,
          message
        )
      )
        return;

      await channel.thread.post({ markdown: message });
    },
    "message.appended"() {
      return undefined;
    },
    "message.completed"() {
      return undefined;
    },
  },
  onMessage(_context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const scope = accessScopeForUser(auth.principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
        },
      },
    };
  },
});

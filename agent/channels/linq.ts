/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access -- Eve's Linq adapter exposes the thread through a transitive Chat SDK type; TypeScript still checks this contextual handler. */
import { connectLinqCredentials } from "@vercel/connect/eve";
import { defaultLinqAuth, linqChannel } from "eve/channels/linq";
import { accessScopeForUser } from "@/lib/access-scope";
import {
  claimConversationMessageRelay,
  conversationMessageFromActionResult,
} from "@/lib/conversation-message";
import { LINQ_CONNECTOR } from "@/lib/linq";
import { normalizeAuthPhoneNumber } from "@/lib/phone-number";
import { findVerifiedAuthUserIdByPhoneNumber } from "@/lib/server/auth-user";

export default linqChannel({
  credentials: connectLinqCredentials(LINQ_CONNECTOR),
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
  async onMessage(_context, message) {
    if (message.author.isBot) return null;

    const auth = defaultLinqAuth(message);
    const authorUserName: unknown = message.author.userName;
    const phoneNumber =
      typeof authorUserName === "string"
        ? normalizeAuthPhoneNumber(authorUserName)
        : undefined;
    const verifiedUserId = phoneNumber
      ? await findVerifiedAuthUserIdByPhoneNumber(phoneNumber)
      : undefined;
    const principalId = verifiedUserId
      ? `better-auth:${verifiedUserId}`
      : auth.principalId;
    const scope = accessScopeForUser(principalId);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          workspaceId: scope.workspaceId,
        },
        principalId,
      },
    };
  },
});

import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { claimSession } from "@/db/services/sessions";
import { scopeFromPrincipal } from "@/lib/access-scope";

export const sessionOwnerDependencies = { claimSession, ensureScope, saveChat };

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      await sessionOwnerDependencies.ensureScope(scope);
      await sessionOwnerDependencies.claimSession(scope, ctx.session.id);
    },
    async "message.received"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      await sessionOwnerDependencies.saveChat(scopeFromPrincipal(initiator), {
        sessionId: ctx.session.id,
      });
    },
  },
});

import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { claimSession } from "@/db/services/sessions";
import { scopeFromPrincipal } from "@/lib/access-scope";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      await ensureScope(scope);
      await claimSession(scope, ctx.session.id);
    },
    async "message.received"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      await saveChat(scopeFromPrincipal(initiator), {
        sessionId: ctx.session.id,
      });
    },
  },
});

import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { claimSession } from "@/db/services/sessions";
import { scopeFromPrincipal } from "@/agent/lib/principal-scope";
import { reconcileProactions } from "@/agent/lib/proactions/reconcile";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      await ensureScope(scope);
      await claimSession(scope, ctx.session.id);
      if (
        initiator.principalType !== "user" ||
        initiator.authenticator === "scheduled-worker"
      ) {
        return;
      }
      try {
        // A user showing up is the cheapest moment to activate any proaction
        // whose prerequisites are now met.
        await reconcileProactions(scope);
      } catch (error) {
        console.warn("[proactions] reconcile failed on session start", {
          cause: error,
          sessionId: ctx.session.id,
        });
      }
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

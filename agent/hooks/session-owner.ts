import { defineHook, type HookContext } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { claimSession } from "@/db/services/sessions";
import { scopeFromPrincipal } from "@/agent/lib/principal-scope";
import { reconcileProactions } from "@/agent/lib/proactions/reconcile";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const scope = await claimOwnedSession(ctx);
      const initiator = ctx.session.auth.initiator;
      if (
        !scope ||
        initiator?.principalType !== "user" ||
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
      const scope = await claimOwnedSession(ctx);
      if (!scope) return;

      await saveChat(scope, {
        channel: ctx.channel.kind,
        sessionId: ctx.session.id,
      });
    },
  },
});

async function claimOwnedSession(ctx: HookContext) {
  const initiator = ctx.session.auth.initiator;
  if (!initiator) return undefined;

  const scope = scopeFromPrincipal(initiator);
  await ensureScope(scope);
  await claimSession(scope, ctx.session.id);
  return scope;
}

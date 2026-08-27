import { defineHook } from "eve/hooks";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { getAppStore } from "@/lib/server/app-store";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      const store = await getAppStore();
      await store.ensureScope(scope);
      await store.claimSession(scope, ctx.session.id);
    },
  },
});

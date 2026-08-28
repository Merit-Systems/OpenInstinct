import { defineHook } from "eve/hooks";
import { scopeFromPrincipal } from "../../lib/access-scope.js";
import {
  claimAgentSession,
  ensureWorkspace,
} from "../../lib/server/workspace-data.js";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      await ensureWorkspace(scope);
      await claimAgentSession(scope, ctx.session.id);
    },
  },
});

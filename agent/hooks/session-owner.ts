import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { checkBudget, recordUsageEvent } from "@/db/services/usage";
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
    async "turn.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator) return;
      await checkBudget(scopeFromPrincipal(initiator), "model_tokens");
    },
    async "step.completed"(event, ctx) {
      const initiator = ctx.session.auth.initiator;
      const usage = event.data.usage;
      if (!initiator || !usage) return;
      const quantity = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      if (quantity <= 0) return;
      const scope = scopeFromPrincipal(initiator);
      void recordUsageEvent(scope, {
        costEstimateUsd: usage.costUsd,
        kind: "model_tokens",
        metadata: {
          stepIndex: event.data.stepIndex,
          turnId: event.data.turnId,
        },
        quantity,
        sessionId: ctx.session.id,
        unit: "tokens",
      }).catch(() => {
        console.warn("[usage] usage event recording failed");
      });
    },
  },
});

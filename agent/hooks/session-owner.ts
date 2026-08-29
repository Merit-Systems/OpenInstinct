import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { checkBudget } from "@/db/services/usage";
import { recordUsageEvent } from "@/db/services/usage";
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
      const scope = scopeFromPrincipal(initiator);
      await checkBudget(scope, "model_tokens");
    },
    async "step.completed"(event, ctx) {
      const initiator = ctx.session.auth.initiator;
      if (!initiator || !event.data.usage) return;
      const inputTokens = event.data.usage.inputTokens ?? 0;
      const outputTokens = event.data.usage.outputTokens ?? 0;
      const quantity = inputTokens + outputTokens;
      if (quantity <= 0) return;
      void recordUsageEvent(scopeFromPrincipal(initiator), {
        costEstimateUsd: event.data.usage.costUsd,
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

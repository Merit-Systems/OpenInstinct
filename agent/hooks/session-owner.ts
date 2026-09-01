import { defineHook } from "eve/hooks";
import { saveChat } from "@/db/services/chats";
import { ensureScope } from "@/db/services/scope";
import { checkBudget } from "@/db/services/usage";
import { recordUsageEvent } from "@/db/services/usage";
import { claimSession } from "@/db/services/sessions";
import { scopeFromPrincipal } from "@/lib/access-scope";

export interface SessionOwnerContext {
  readonly scope?: ReturnType<typeof scopeFromPrincipal>;
  readonly sessionId: string;
}

export interface SessionOwnerStepCompletedEvent {
  readonly data: {
    readonly stepIndex: number;
    readonly turnId: string;
    readonly usage?: {
      readonly costUsd?: number;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    };
  };
}

export const sessionOwnerDependencies = {
  checkBudget,
  claimSession,
  ensureScope,
  recordUsageEvent,
  saveChat,
};

export function createSessionOwnerHandlers() {
  return {
    async messageReceived(context: SessionOwnerContext) {
      if (!context.scope) return;
      await sessionOwnerDependencies.saveChat(context.scope, {
        sessionId: context.sessionId,
      });
    },
    async sessionStarted(context: SessionOwnerContext) {
      if (!context.scope) return;
      await sessionOwnerDependencies.ensureScope(context.scope);
      await sessionOwnerDependencies.claimSession(
        context.scope,
        context.sessionId
      );
    },
    async stepCompleted(
      event: SessionOwnerStepCompletedEvent,
      context: SessionOwnerContext
    ) {
      if (!context.scope || !event.data.usage) return;
      const inputTokens = event.data.usage.inputTokens ?? 0;
      const outputTokens = event.data.usage.outputTokens ?? 0;
      const quantity = inputTokens + outputTokens;
      if (quantity <= 0) return;
      void sessionOwnerDependencies
        .recordUsageEvent(context.scope, {
          costEstimateUsd: event.data.usage.costUsd,
          kind: "model_tokens",
          metadata: {
            stepIndex: event.data.stepIndex,
            turnId: event.data.turnId,
          },
          quantity,
          sessionId: context.sessionId,
          unit: "tokens",
        })
        .catch(() => {
          console.warn("[usage] usage event recording failed");
        });
    },
    async turnStarted(context: SessionOwnerContext) {
      if (!context.scope) return;
      await sessionOwnerDependencies.checkBudget(context.scope, "model_tokens");
    },
  };
}

const sessionOwnerHandlers = createSessionOwnerHandlers();

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      await sessionOwnerHandlers.sessionStarted(sessionOwnerContext(ctx));
    },
    async "message.received"(_event, ctx) {
      await sessionOwnerHandlers.messageReceived(sessionOwnerContext(ctx));
    },
    async "turn.started"(_event, ctx) {
      await sessionOwnerHandlers.turnStarted(sessionOwnerContext(ctx));
    },
    async "step.completed"(event, ctx) {
      await sessionOwnerHandlers.stepCompleted(event, sessionOwnerContext(ctx));
    },
  },
});

function sessionOwnerContext(ctx: {
  readonly session: {
    readonly auth: {
      readonly initiator: Parameters<typeof scopeFromPrincipal>[0] | null;
    };
    readonly id: string;
  };
}): SessionOwnerContext {
  const initiator = ctx.session.auth.initiator;
  return {
    scope: initiator ? scopeFromPrincipal(initiator) : undefined,
    sessionId: ctx.session.id,
  };
}

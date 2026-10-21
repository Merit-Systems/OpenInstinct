import { defineHook, type HookContext } from "eve/hooks";
import { scopeFromPrincipal } from "@agent/lib/principal-scope";
import { resolveModeValue } from "@agent/lib/mode";
import { captureKnowledgeInput } from "@agent/lib/memory/ingest";
import { discardUnusedMemoryTurnInputs } from "@db/services/memory/sources";
import {
  readMemoryBinding,
  setMemoryCaptureDisabled,
  type MemoryCaptureBoundary,
} from "@db/services/memory/scope";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";

function interactiveScope(context: HookContext) {
  const caller = context.session.auth.current;
  if (context.session.parent || caller?.principalType !== "user") return null;
  const scope = resolveModeValue(context, {
    interactive: scopeFromPrincipal(caller),
  });
  return scope && knowledgeMemoryModeForWorkspace(scope.workspaceId) !== "off"
    ? scope
    : null;
}

async function disableCapture(
  context: HookContext,
  boundary: MemoryCaptureBoundary
) {
  const scope = interactiveScope(context);
  if (!scope) return;
  const binding = await readMemoryBinding(scope, context.session.id);
  if (binding)
    await setMemoryCaptureDisabled(
      scope,
      binding.scopeKey,
      context.session.id,
      boundary
    );
}

async function finishTurn(context: HookContext, turnId: string) {
  const scope = interactiveScope(context);
  if (!scope) return;
  const binding = await readMemoryBinding(scope, context.session.id);
  if (binding)
    await discardUnusedMemoryTurnInputs(
      scope,
      binding.scopeKey,
      context.session.id,
      turnId
    );
}

export default defineHook({
  events: {
    async "message.received"(event, context) {
      const scope = interactiveScope(context);
      if (!scope || event.data.kind) return;
      const binding = await readMemoryBinding(scope, context.session.id);
      if (!binding || binding.captureDisabled) return;
      await captureKnowledgeInput({
        scope,
        scopeKey: binding.scopeKey,
        sessionId: context.session.id,
        turnId: event.data.turnId,
        text: event.data.parts
          ? event.data.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
          : event.data.message,
        kind: event.data.kind,
        observedAt: event.meta.at,
        eventId: event.meta.id,
      });
    },
    async "authorization.required"(event, context) {
      await disableCapture(context, {
        turnId: event.data.turnId,
        observedAt: event.meta.at,
      });
    },
    async "input.requested"(event, context) {
      await disableCapture(context, {
        turnId: event.data.turnId,
        observedAt: event.meta.at,
      });
    },
    async "turn.completed"(event, context) {
      await finishTurn(context, event.data.turnId);
    },
    async "turn.failed"(event, context) {
      await finishTurn(context, event.data.turnId);
    },
    async "turn.cancelled"(event, context) {
      await finishTurn(context, event.data.turnId);
    },
  },
});

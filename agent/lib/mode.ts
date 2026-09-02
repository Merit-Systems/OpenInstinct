import type { DynamicResolveContext } from "eve";
import { defineInstructions } from "eve/instructions";

interface AgentModeContext {
  readonly session: {
    readonly auth: Pick<
      DynamicResolveContext["session"]["auth"],
      "current" | "initiator"
    >;
  };
}

function agentMode(authenticator: string | undefined) {
  if (authenticator === "scheduled-worker") return "scheduled-worker" as const;
  if (authenticator === "scheduled-result") return "scheduled-report" as const;
  return "interactive" as const;
}

type AgentMode = ReturnType<typeof agentMode>;

function sessionAgentMode(auth: AgentModeContext["session"]["auth"]) {
  if (auth.initiator?.authenticator === "scheduled-worker") {
    return "scheduled-worker" as const;
  }
  const caller = auth.current ?? auth.initiator;
  return agentMode(caller?.authenticator);
}

export function resolveModeValue<T>(
  context: AgentModeContext,
  valueByMode: Partial<Record<AgentMode, T>>
) {
  return valueByMode[sessionAgentMode(context.session.auth)] ?? null;
}

export function resolveModeInstructions(
  context: DynamicResolveContext,
  contentByMode: Partial<Record<AgentMode, string>>
) {
  const content = resolveModeValue(context, contentByMode);
  return content === null ? null : defineInstructions({ content });
}

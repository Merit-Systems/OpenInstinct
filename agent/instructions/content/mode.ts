import {
  defineInstructions,
  type DynamicResolveContext,
} from "eve/instructions";

export function instructionMode(authenticator: string | undefined) {
  if (authenticator === "scheduled-worker") return "scheduled-worker" as const;
  if (authenticator === "scheduled-result") return "scheduled-report" as const;
  return "interactive" as const;
}

export function resolveModeInstructions(
  context: DynamicResolveContext,
  contentByMode: Partial<Record<ReturnType<typeof instructionMode>, string>>
) {
  const caller = context.session.auth.current ?? context.session.auth.initiator;
  const content = contentByMode[instructionMode(caller?.authenticator)];
  return content === undefined ? null : defineInstructions({ content });
}

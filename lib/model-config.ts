import { readGatewayModel } from "@/db/services/settings";
import type { AccessScope } from "./access-scope";

export const DIRECT_HAIKU_MODEL_ID = "anthropic/claude-haiku-4.5";
export const DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS = 200_000;

export function createDirectHaikuSelection<TModel>(model: TModel) {
  return {
    model,
    modelContextWindowTokens: DIRECT_HAIKU_CONTEXT_WINDOW_TOKENS,
  } as const;
}

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId: (await readGatewayModel(scope)) ?? DIRECT_HAIKU_MODEL_ID,
  };
}

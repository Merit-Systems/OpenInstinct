import type { AccessScope } from "./access-scope";
import { getAppStore } from "./server/app-store";
import {
  getTrustedRouterConfig,
  selectTrustedRouterModel,
} from "./trustedrouter";

export async function getModelSettings(scope: AccessScope) {
  const selectedId = await (await getAppStore()).readGatewayModel(scope);

  const trustedRouter = getTrustedRouterConfig();
  if (trustedRouter) return selectTrustedRouterModel(trustedRouter, selectedId);

  const modelId = selectedId ?? "openai/gpt-5.6-sol-fast";
  return { model: modelId, modelContextWindowTokens: undefined, modelId };
}

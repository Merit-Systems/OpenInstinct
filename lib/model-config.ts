import type { AccessScope } from "./access-scope";
import { getAppStore } from "./server/app-store";

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId:
      (await (await getAppStore()).readGatewayModel(scope)) ??
      "openai/gpt-5.6-sol-fast",
  };
}

import type { AccessScope } from "./access-scope";
import { readGatewayModel } from "./server/settings-data";

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId: (await readGatewayModel(scope)) ?? "openai/gpt-5.6-sol-fast",
  };
}

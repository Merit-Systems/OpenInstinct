import { readGatewayModel } from "@/db/services/settings";
import type { AccessScope } from "./access-scope";

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId: (await readGatewayModel(scope)) ?? "openai/gpt-5.6-sol-fast",
  };
}

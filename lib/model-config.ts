import { readGatewayModel } from "@/db/services/settings";
import type { AccessScope } from "./access-scope";

export const DIRECT_HAIKU_MODEL_ID = "anthropic/claude-haiku-4.5";

export async function getModelSettings(scope: AccessScope) {
  return {
    modelId: (await readGatewayModel(scope)) ?? DIRECT_HAIKU_MODEL_ID,
  };
}

import { getEnv } from "./runtime-env";
import { getAppStore } from "./server/database";
import { readSecretSync } from "./server/secret-store";

export async function getModelSettings() {
  const env = getEnv();
  const { localModel, settings } = await (
    await getAppStore()
  ).readModelStorage();
  const configuredBaseURL = env.LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL?.trim();
  const usesStoredModel =
    !configuredBaseURL &&
    settings.model_source !== "gateway" &&
    Boolean(localModel?.endpoint);
  const baseURL =
    configuredBaseURL ??
    (usesStoredModel ? normalize(localModel?.endpoint) : undefined);
  const configuredModel =
    env.LOCAL_VAULT_ASSISTANT_MODEL?.trim() ??
    (usesStoredModel
      ? normalize(localModel?.account)
      : normalize(settings.gateway_model));
  const modelId =
    configuredModel && configuredModel.length > 0
      ? configuredModel
      : baseURL
        ? "gpt-oss:20b"
        : "openai/gpt-5.6-sol-fast";

  return {
    apiKey:
      env.LOCAL_VAULT_ASSISTANT_MODEL_API_KEY?.trim() ??
      (usesStoredModel && localModel
        ? readSecretSync({ id: localModel.id, namespace: "connection" })
        : undefined),
    baseURL,
    modelId,
    source: baseURL ? ("local" as const) : ("gateway" as const),
  };
}

function normalize(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return;
  return normalized;
}

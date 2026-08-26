import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getEnv } from "./runtime-env";
import { getLocalDataDirectory } from "./data-directory";
import { readSecretSync } from "./server/secret-store";

const localModelRowSchema = z
  .object({
    account: z.string(),
    endpoint: z.string(),
    id: z.string(),
  })
  .nullish();

export function getModelSettings() {
  const env = getEnv();
  const storedModel = readStoredLocalModel();
  const configuredBaseURL = env.LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL?.trim();
  const usesStoredModel = !configuredBaseURL && Boolean(storedModel?.endpoint);
  const baseURL = configuredBaseURL ?? normalize(storedModel?.endpoint);
  const configuredModel =
    env.LOCAL_VAULT_ASSISTANT_MODEL?.trim() ??
    (usesStoredModel ? normalize(storedModel?.account) : undefined);
  const modelId =
    configuredModel && configuredModel.length > 0
      ? configuredModel
      : baseURL
        ? "gpt-oss:20b"
        : "openai/gpt-5.6-sol-fast";

  return {
    apiKey:
      env.LOCAL_VAULT_ASSISTANT_MODEL_API_KEY?.trim() ??
      (usesStoredModel && storedModel
        ? readSecretSync({ id: storedModel.id, namespace: "connection" })
        : undefined),
    baseURL,
    modelId,
  };
}

function readStoredLocalModel() {
  const filename = join(getLocalDataDirectory(), "manager.sqlite");
  if (!existsSync(filename)) return;

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(filename, { readOnly: true });
    return localModelRowSchema.parse(
      database
        .prepare(
          "SELECT id, account, endpoint FROM connections WHERE provider = 'local-model' AND endpoint <> '' ORDER BY updated_at DESC LIMIT 1"
        )
        .get()
    );
  } catch {
    return;
  } finally {
    database?.close();
  }
}

function normalize(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return;
  return normalized;
}

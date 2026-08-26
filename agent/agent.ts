import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";
import { getModelSettings } from "../lib/model-config.js";

const modelSettings = getModelSettings();
const localProvider = modelSettings.baseURL
  ? createOpenAICompatible({
      apiKey: modelSettings.apiKey,
      baseURL: modelSettings.baseURL,
      includeUsage: true,
      name: "local-vault-assistant-model",
    })
  : undefined;

export default defineAgent({
  model: localProvider
    ? localProvider.chatModel(modelSettings.modelId)
    : modelSettings.modelId,
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

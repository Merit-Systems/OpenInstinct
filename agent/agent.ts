import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent, defineDynamic } from "eve";
import { getModelSettings } from "../lib/model-config.js";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": () => {
        const modelSettings = getModelSettings();
        if (!modelSettings.baseURL) return modelSettings.modelId;

        return createOpenAICompatible({
          apiKey: modelSettings.apiKey,
          baseURL: modelSettings.baseURL,
          includeUsage: true,
          name: "local-vault-assistant-model",
        }).chatModel(modelSettings.modelId);
      },
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

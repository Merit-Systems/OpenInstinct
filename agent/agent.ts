import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent, defineDynamic } from "eve";
import { getModelSettings } from "../lib/model-config.js";
import { scopeFromPrincipal } from "../lib/access-scope.js";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        const modelSettings = await getModelSettings(
          scopeFromPrincipal(caller)
        );
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

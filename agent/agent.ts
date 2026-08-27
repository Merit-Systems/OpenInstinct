import { createAnthropic } from "@ai-sdk/anthropic";
import { defineAgent, defineDynamic } from "eve";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { env } from "@/lib/env";
import {
  createDirectHaikuSelection,
  DIRECT_HAIKU_MODEL_ID,
  getModelSettings,
} from "@/lib/model-config";

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export default defineAgent({
  experimental: {
    tasks: true,
  },
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        const { modelId } = await getModelSettings(scopeFromPrincipal(caller));
        return modelId === DIRECT_HAIKU_MODEL_ID
          ? createDirectHaikuSelection(anthropic("claude-haiku-4-5"))
          : modelId;
      },
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

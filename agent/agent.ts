import { defineAgent, defineDynamic } from "eve";
import { getModelSettings } from "../lib/model-config.js";
import { scopeFromPrincipal } from "../lib/access-scope.js";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        return (await getModelSettings(scopeFromPrincipal(caller))).modelId;
      },
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

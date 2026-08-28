import { defineAgent, defineDynamic } from "eve";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { getModelSettings } from "@/lib/model-config";
import { taskCompletionSchema } from "@/lib/task-completion";

export default defineAgent({
  description:
    "Complete one bounded task on a known website, using saved vault data and returning optional image evidence when needed.",
  model: defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        return (await getModelSettings(scopeFromPrincipal(caller))).modelId;
      },
    },
  }),
  reasoning: "low",
  outputSchema: taskCompletionSchema,
  compaction: {
    thresholdPercent: 0.7,
  },
});

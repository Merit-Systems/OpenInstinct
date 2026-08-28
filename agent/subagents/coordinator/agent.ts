import { defineAgent, defineDynamic } from "eve";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { getModelSettings } from "@/lib/model-config";
import { taskCompletionSchema } from "@/lib/task-completion";

export default defineAgent({
  description:
    "Own substantial research, planning, connected-service work, and browser-task coordination for the user-facing root. Return one concise user-ready result; delegate only actual browser interaction to the nested browser specialist.",
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

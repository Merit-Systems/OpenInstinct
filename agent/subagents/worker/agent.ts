import { defineAgent, defineDynamic } from "eve";
import { getGatewayModel } from "@/db/services/settings";
import { scopeFromPrincipal } from "@/lib/access-scope";
import { taskCompletionSchema } from "@/lib/worker-completion";

export default defineAgent({
  description:
    "Execute one bounded browser assignment for the root coordinator, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result. Every initial and resumed call must include the task-completion outputSchema required by the root instructions.",
  model: defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        return getGatewayModel(scopeFromPrincipal(caller));
      },
    },
  }),
  reasoning: "low",
  outputSchema: taskCompletionSchema,
  compaction: {
    thresholdPercent: 0.7,
  },
});

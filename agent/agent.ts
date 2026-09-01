import { defineAgent, defineDynamic } from "eve";
import { getGatewayModel } from "@/db/services/settings";
import { scopeFromPrincipal } from "@/lib/access-scope";

export default defineAgent({
  experimental: {
    tasks: true,
  },
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
        if (!caller) throw new Error("An authenticated user is required.");
        return getGatewayModel(scopeFromPrincipal(caller));
      },
    },
  }),
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

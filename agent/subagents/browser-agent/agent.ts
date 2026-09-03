import { defineAgent, defineDynamic } from "eve";
import { resolveModeValue } from "@/agent/lib/mode";
import { taskCompletionSchema } from "@/lib/worker-completion";

export default defineDynamic({
  build: {
    externalDependencies: ["@onkernel/browser-loop"],
  },
  events: {
    "turn.started": (_event, context) => {
      const worker = defineAgent({
        description:
          "Execute one bounded browser assignment for the root coordinator, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result. Every initial and resumed call must include the task-completion outputSchema required by the root instructions.",
        model: "zai/glm-5.2",
        reasoning: "low",
        outputSchema: taskCompletionSchema,
        compaction: {
          thresholdPercent: 0.7,
        },
      });
      return resolveModeValue(context, {
        interactive: worker,
        "scheduled-worker": worker,
      });
    },
  },
});

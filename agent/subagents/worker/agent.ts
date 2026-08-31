import { defineAgent } from "eve";
import { taskCompletionSchema } from "@/lib/task-completion";

export default defineAgent({
  build: {
    externalDependencies: ["@onkernel/browser-loop"],
  },
  description:
    "Execute one bounded browser assignment for the root coordinator, including secure vault autofill, transaction preparation, optional durable browser images, human-takeover handoff, cleanup, and a concise verified result. Every initial and resumed call must include the task-completion outputSchema required by the root instructions.",
  model: "zai/glm-5.2",
  reasoning: "low",
  outputSchema: taskCompletionSchema,
  compaction: {
    thresholdPercent: 0.7,
  },
});

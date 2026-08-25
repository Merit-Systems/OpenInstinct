import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-5.6-sol-fast",
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

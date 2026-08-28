import { defineAgent } from "eve";

export default defineAgent({
  experimental: {
    tasks: true,
  },
  model: "openai/gpt-5.6-luna",
  reasoning: "low",
  compaction: {
    thresholdPercent: 0.7,
  },
});

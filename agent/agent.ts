import { defineAgent } from "eve";

export default defineAgent({
  experimental: {
    tasks: true,
  },
  model: "openai/gpt-5.6-sol-fast",
  reasoning: "minimal",
  compaction: {
    thresholdPercent: 0.7,
  },
});

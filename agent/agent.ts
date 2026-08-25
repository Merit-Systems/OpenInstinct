import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-5.6-sol",
  reasoning: "xhigh",
  compaction: {
    thresholdPercent: 0.7,
  },
});

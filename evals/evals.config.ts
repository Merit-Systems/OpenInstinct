import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  judge: { model: "openai/gpt-5.4-mini" },
  maxConcurrency: 4,
  timeoutMs: 180_000,
});

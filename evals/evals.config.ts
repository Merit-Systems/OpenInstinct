import { defineEvalConfig } from "eve/evals";
import { browserBenchmarkReporter } from "@/evals/browser/benchmark-reporter";

export default defineEvalConfig({
  judge: { model: "openai/gpt-5.4-mini" },
  maxConcurrency: 8,
  reporters: [browserBenchmarkReporter],
  timeoutMs: 180_000,
});

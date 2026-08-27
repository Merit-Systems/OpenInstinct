import { defineEvalConfig } from "eve/evals";
import { browserBenchmarkReporter } from "@/evals/browser/benchmark-reporter";

export default defineEvalConfig({
  maxConcurrency: 8,
  reporters: [browserBenchmarkReporter],
  timeoutMs: 180_000,
});

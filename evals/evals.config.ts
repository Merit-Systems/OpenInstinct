import { defineEvalConfig } from "eve/evals";
import { browserBenchmarkReporter } from "./browser/benchmark-reporter.js";

export default defineEvalConfig({
  maxConcurrency: 8,
  reporters: [browserBenchmarkReporter],
  timeoutMs: 180_000,
});

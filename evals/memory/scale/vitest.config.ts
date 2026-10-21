import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../../vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["evals/memory/scale/benchmark.ts"],
      testTimeout: 60_000,
    },
  })
);

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const browserBenchmarkEnv = createEnv({
  server: {
    BROWSER_BENCH_LABEL: z.string().min(1).optional(),
    BROWSER_BENCH_REPETITIONS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(1),
    BROWSER_BENCH_SCOPE_PRINCIPAL: z.string().min(1).optional(),
    BROWSER_BENCH_SUITE: z
      .enum(["all", "live", "profile", "smoke"])
      .default("smoke"),
  },
  experimental__runtimeEnv: {},
});

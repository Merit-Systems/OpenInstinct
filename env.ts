import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export function getEnv() {
  return createEnv({
    server: {
      BROWSER_BENCH_LABEL: z.string().min(1).optional(),
      BROWSER_BENCH_REPETITIONS: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(1),
      KERNEL_API_KEY: z.string().min(1),
    },
    experimental__runtimeEnv: {},
  });
}

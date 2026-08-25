import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export function getEnv() {
  return createEnv({
    server: {
      KERNEL_API_KEY: z.string().min(1),
    },
    experimental__runtimeEnv: {},
  });
}

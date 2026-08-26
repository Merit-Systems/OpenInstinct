import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalValue = z
  .string()
  .transform((value) => (value.trim().length === 0 ? undefined : value))
  .optional();

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
      KERNEL_API_KEY: optionalValue,
      LOCAL_VAULT_ASSISTANT_ALLOW_REMOTE_MANAGER: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
      LOCAL_VAULT_ASSISTANT_DATA_DIR: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODEL: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODEL_API_KEY: optionalValue,
      LOCAL_VAULT_ASSISTANT_MODEL_BASE_URL: optionalValue,
      VERCEL: optionalValue,
    },
    experimental__runtimeEnv: {},
  });
}

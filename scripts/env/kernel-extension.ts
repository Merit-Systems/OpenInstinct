import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalValue = z
  .string()
  .transform((value) => (value.trim().length === 0 ? undefined : value))
  .optional();

export const kernelExtensionEnv = createEnv({
  server: {
    KERNEL_API_KEY: optionalValue,
    KERNEL_VAULT_AUTOFILL_EXTENSION: z
      .string()
      .min(1)
      .default("vault-autofill"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});

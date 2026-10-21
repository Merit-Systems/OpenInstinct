import { z } from "zod";

export const scaleEnvironment = z
  .object({
    MEMORY_SCALE_OUTPUT: z.string().min(1),
    MEMORY_SCALE_RUN: z.coerce.number().int().min(1).max(3),
  })
  .parse(process.env);

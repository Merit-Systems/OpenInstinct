import { z } from "zod";

export const fillFromVaultRequestSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500),
  candidateId: z.string().trim().min(1).max(500),
});

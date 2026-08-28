import { z } from "zod";

export const inspectAutofillRequestSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500),
});

export const fillFromVaultRequestSchema = inspectAutofillRequestSchema.extend({
  candidateId: z.string().trim().min(1).max(500),
  surfaceId: z.string().trim().min(1).max(120),
});

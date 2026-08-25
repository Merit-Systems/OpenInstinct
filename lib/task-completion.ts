import { z } from "zod";

export const taskCompletionSchema = z.object({
  status: z.enum(["success", "failure"]),
  message: z.string().trim().min(1),
});

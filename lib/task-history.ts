import { z } from "zod";

export const taskHistoryPageSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  runs: z.array(
    z.object({
      createdAt: z.string(),
      prompt: z.string(),
      sessionId: z.string(),
      status: z.enum([
        "cancelled",
        "completed",
        "failed",
        "pending",
        "running",
      ]),
      updatedAt: z.string(),
    })
  ),
});

export type TaskHistoryPage = z.infer<typeof taskHistoryPageSchema>;
export type TaskHistoryRun = TaskHistoryPage["runs"][number];

import { z } from "zod";

export const linqReactionRequestSchema = z.object({
  reaction: z
    .enum(["love", "like", "dislike", "laugh", "emphasize", "question"])
    .describe("The native iMessage tapback to add."),
});

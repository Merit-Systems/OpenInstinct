import { z } from "zod";

export const reactToMessageOutputSchema = z.object({
  operation: z.enum(["add", "remove"]).default("add"),
  type: z.enum([
    "thumbs_up",
    "thumbs_down",
    "heart",
    "laugh",
    "exclamation",
    "question",
  ]),
});

export const reactToMessageToolResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: reactToMessageOutputSchema,
  toolName: z.literal("react_to_message"),
});

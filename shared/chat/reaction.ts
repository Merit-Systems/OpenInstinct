import emojiRegex from "emoji-regex";
import { z } from "zod";

const emojiPattern = new RegExp(emojiRegex().source);

export const reactToMessageInputSchema = z.object({
  messageId: z
    .string()
    .min(1)
    .describe(
      "Exact supplied ID of the message to react to in this conversation."
    ),
  operation: z.enum(["add", "remove"]).default("add"),
  emoji: z
    .string()
    .refine(
      (emoji) =>
        emojiPattern.exec(emoji)?.[0] === emoji &&
        !/^\p{Emoji_Component}$/u.test(emoji),
      "Provide exactly one real Unicode emoji, not a name, text, or multiple emojis."
    )
    .describe("One Unicode emoji to add or remove from the target message."),
});

// Persisted tool results used named reactions and did not record their target.
const legacyReactionText = {
  exclamation: "‼️",
  heart: "❤️",
  laugh: "😂",
  question: "❓",
  thumbs_down: "👎",
  thumbs_up: "👍",
} as const;

const legacyReactionTypeSchema = z.enum(
  Object.keys(legacyReactionText).filter(
    (key): key is keyof typeof legacyReactionText =>
      Object.hasOwn(legacyReactionText, key)
  )
);

export const reactToMessageOutputSchema = z.union([
  reactToMessageInputSchema,
  reactToMessageInputSchema
    .omit({ emoji: true, messageId: true })
    .extend({ type: legacyReactionTypeSchema })
    .strict()
    .transform(({ type, operation }) => ({
      operation,
      emoji: legacyReactionText[type],
    })),
]);

export const reactToMessageToolResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: reactToMessageOutputSchema,
  toolName: z.literal("react_to_message"),
});

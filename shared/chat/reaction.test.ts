import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  reactToMessageInputSchema,
  reactToMessageOutputSchema,
} from "./reaction";

describe("reaction contracts", () => {
  it.each([
    "👀",
    "🤔",
    "🙌",
    "👍🏽",
    "👩🏽‍💻",
    "🇺🇸",
    "1️⃣",
    "🏳️‍🌈",
    "👨‍👩‍👧‍👦",
    "❤️",
    "❤",
    "‼️",
    "✅",
  ])("accepts one Unicode emoji: %s", (emoji) => {
    expect(
      reactToMessageInputSchema.parse({ emoji, messageId: "message-2" })
    ).toEqual({ emoji, messageId: "message-2", operation: "add" });
  });
  it.each([
    "",
    "thumbs_up",
    ":eyes:",
    "working 👀",
    "👀👍",
    "👀\n",
    " 👀",
    "1",
    "🇺",
    "🏻",
    "\uFE0F",
    "🦄‍🦄",
    "👀🏽",
    "👀\u200D",
    "\uD83D",
  ])("rejects text, multiple emojis, and invalid sequences: %j", (emoji) => {
    expect(() =>
      reactToMessageInputSchema.parse({ emoji, messageId: "message-2" })
    ).toThrow("Provide exactly one real Unicode emoji");
  });
  it("requires an explicit target for new reactions", () => {
    expect(reactToMessageInputSchema.safeParse({ emoji: "👍" }).success).toBe(
      false
    );
    expect(
      reactToMessageInputSchema.safeParse({ emoji: "👍", messageId: "" })
        .success
    ).toBe(false);
  });
  it("does not put the Unicode table in the model schema", () => {
    const schema = z.toJSONSchema(reactToMessageInputSchema);
    expect(schema.properties?.emoji).toEqual({
      type: "string",
      description:
        "One Unicode emoji to add or remove from the target message.",
    });
    expect(schema.properties).not.toHaveProperty("type");
  });
  it.each([
    ["heart", "❤️"],
    ["thumbs_up", "👍"],
    ["thumbs_down", "👎"],
    ["laugh", "😂"],
    ["exclamation", "‼️"],
    ["question", "❓"],
  ])("reads historical named %s reactions", (type, emoji) => {
    expect(reactToMessageOutputSchema.parse({ type })).toEqual({
      operation: "add",
      emoji,
    });
    expect(
      reactToMessageOutputSchema.parse({ type, operation: "remove" })
    ).toEqual({ operation: "remove", emoji });
    expect(reactToMessageInputSchema.safeParse({ type }).success).toBe(false);
  });
  it("does not hide an invalid new emoji behind a legacy reaction type", () => {
    expect(
      reactToMessageOutputSchema.safeParse({
        messageId: "message-2",
        emoji: "not-an-emoji",
        type: "heart",
      }).success
    ).toBe(false);
  });
});

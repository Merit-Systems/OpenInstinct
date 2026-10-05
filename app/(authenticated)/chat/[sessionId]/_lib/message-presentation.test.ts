import { defaultMessageReducer } from "eve/client";
import { describe, expect, it } from "vitest";
import {
  firstNativeMessageId,
  historyToolResult,
  messageHistoryEvents,
  removeOldReactionEvent,
  secondPhoto,
} from "@tests/fixtures/message-history";
import { messagePresentations } from "./message-presentation";
import { formatMessageContext } from "@shared/chat/message-context";
import { imessageTimestamps } from "./message-events";

function project(events = messageHistoryEvents) {
  const reducer = defaultMessageReducer();
  const { messages } = events.reduce(
    (data, event) => reducer.reduce(data, event),
    reducer.initial()
  );
  return { messages, ...messagePresentations(messages, events) };
}

describe("message history presentation", () => {
  it("preserves empty or unrelated Parts annotations beside browser uploads", () => {
    const { messages, presentations } = project();
    const original = messages.find(
      (message) => message.id === "literal-parts:received:user"
    );
    if (!original) throw new Error("Missing literal Parts fixture");
    expect(presentations.get(original.id)?.parts).toBe(original.parts);
    const unrelated = {
      ...original,
      parts: [
        {
          type: "text" as const,
          text: formatMessageContext({
            messageId: "literal-parts-example",
            sender: "user",
            parts: [{ partIndex: 0, type: "text", value: "Another message" }],
          }),
        },
        ...original.parts.slice(1),
      ],
    };
    expect(
      messagePresentations([unrelated], []).presentations.get(unrelated.id)
        ?.parts
    ).toBe(unrelated.parts);
  });

  it("recognizes native attachment-only annotations bound to the original files", () => {
    const { messages } = project();
    const original = messages.find(
      (message) => message.id === "photos:received:user"
    );
    if (!original) throw new Error("Missing photos fixture");
    const files = original.parts.filter((part) => part.type === "file");
    const native = {
      ...original,
      parts: [
        {
          type: "text" as const,
          text: formatMessageContext({
            messageId: firstNativeMessageId,
            sender: "user",
            parts: files.map((file, partIndex) => ({
              partIndex,
              type: "media",
              url: file.url,
            })),
          }),
        },
        ...files,
      ],
    };
    expect(
      messagePresentations([native], []).presentations.get(native.id)?.parts
    ).toEqual(files);
  });
  it("matches timestamps to the reducer's receipt IDs", () => {
    expect(
      imessageTimestamps(messageHistoryEvents).get("photos:received:user")
    ).toBe("2026-10-05T20:00:00.000Z");
  });

  it("selects the quoted occurrence when media parts repeat the same URL", () => {
    const original = messageHistoryEvents[1];
    if (original?.type !== "message.received" || !original.data.parts)
      throw new Error("Missing receipt");
    const files = original.data.parts.filter((part) => part.type === "file");
    const firstFile = files[0];
    const secondFile = files[1];
    const url = firstFile?.url;
    if (!url || !secondFile) throw new Error("Missing image");
    const updated = {
      ...original,
      data: {
        ...original.data,
        parts: [
          {
            type: "text" as const,
            text: formatMessageContext({
              messageId: firstNativeMessageId,
              sender: "user",
              parts: [
                { partIndex: 0, type: "text", value: "Here are two photos." },
                { partIndex: 1, type: "media", url },
                { partIndex: 2, type: "media", url },
              ],
            }),
          },
          { type: "text" as const, text: "Here are two photos." },
          { ...firstFile, url },
          { ...secondFile, url },
        ],
      },
    };
    expect(
      project([
        ...messageHistoryEvents.slice(0, 1),
        updated,
        ...messageHistoryEvents.slice(2),
      ]).presentations.get("quoted:received:user")?.reply?.image?.filename
    ).toBe("blue.svg");
  });

  it("uses the input preceding each reaction when messages steer the same turn", () => {
    const source = messageHistoryEvents[1];
    if (source?.type !== "message.received") throw new Error("Missing receipt");
    const first = {
      ...source,
      meta: { ...source.meta, id: "steer-first" },
      data: {
        ...source.data,
        turnId: "same-turn",
        parts: [{ type: "text" as const, text: "First input" }],
      },
    };
    const second = {
      ...first,
      meta: { ...first.meta, id: "steer-second" },
      data: {
        ...first.data,
        parts: [{ type: "text" as const, text: "Second input" }],
      },
    };
    const events = [
      first,
      historyToolResult("same-turn", "first-heart", "react_to_message", {
        type: "heart",
        operation: "add",
      }),
      historyToolResult("same-turn", "first-eyes", "react_to_message", {
        messageId: "same-turn:user",
        emoji: "👀",
        operation: "add",
      }),
      second,
      historyToolResult("same-turn", "second-like", "react_to_message", {
        type: "thumbs_up",
        operation: "add",
      }),
    ];
    expect(
      project(events).presentations.get("steer-first:user")?.reactions
    ).toEqual(["❤️", "👀"]);
    expect(
      project(events).presentations.get("steer-second:user")?.reactions
    ).toEqual(["👍"]);
  });
  it("resolves turn aliases when paginated history omits turn-start boundaries", () => {
    const events = messageHistoryEvents.filter(
      (event) => event.type !== "turn.started"
    );
    const { presentations } = project(events);
    expect(presentations.get("photos:received:user")?.reactions).toEqual([
      "👍",
    ]);
    expect(presentations.get("legacy:received:user")?.reactions).toEqual([
      "❤️",
    ]);
    expect(presentations.get("quoted:received:user")?.reply?.targetId).toBe(
      "photos:received:user"
    );
  });
  it("retains attachments and original history while projecting annotations", () => {
    const { messages, presentations } = project();
    expect(presentations.get("photos:received:user")?.parts).toHaveLength(3);
    expect(presentations.get("photos:received:user")?.parts[0]).toMatchObject({
      text: "Here are two photos.",
    });
    const original = messages[0]?.parts[0];
    expect(original?.type).toBe("text");
    if (original?.type !== "text") throw new Error("Missing label");
    expect(original.text).toContain("[Parts:");
    expect(presentations.get("app-card:received:user")?.parts).toEqual([
      expect.objectContaining({ text: "[iMessage app card]" }),
    ]);
  });

  it("previews the quoted media part and links the older message", () => {
    const reply = project().presentations.get("quoted:received:user")?.reply;
    expect(reply?.targetId).toBe("photos:received:user");
    expect(reply?.text).toBe("blue.svg");
    expect(reply?.image?.url).toBe(secondPhoto);
  });

  it("targets older IDs and folds add/remove without reacting to the latest message", () => {
    const { presentations, handledReactionCallIds } = project();
    expect(presentations.get("photos:received:user")?.reactions).toEqual([
      "👍",
    ]);
    expect(presentations.get("quoted:received:user")?.reactions).toEqual([]);
    expect(presentations.get("latest:received:user")?.reactions).toEqual([
      "👩🏽‍💻",
    ]);
    expect(handledReactionCallIds.has("remove-eyes")).toBe(true);
    expect(
      project([
        ...messageHistoryEvents,
        removeOldReactionEvent,
      ]).presentations.get("photos:received:user")?.reactions
    ).toEqual([]);
  });

  it("keeps legacy reactions on their turn's browser message", () => {
    expect(
      project().presentations.get("legacy:received:user")?.reactions
    ).toEqual(["❤️"]);
  });

  it("preserves pasted headers with attachments including a fully parsed bare header", () => {
    const { messages, presentations } = project();
    const literal = messages.find(
      (message) => message.id === "literal:received:user"
    );
    expect(presentations.get("literal:received:user")?.parts).toBe(
      literal?.parts
    );
    if (!literal) throw new Error("Missing fixture");
    const valid = {
      ...literal,
      parts: [
        {
          type: "text" as const,
          text: '[Message: {"messageId":"example","sender":"user"}]',
        },
        ...literal.parts.slice(1),
      ],
    };
    expect(
      messagePresentations([valid], []).presentations.get(valid.id)?.parts
    ).toBe(valid.parts);
  });

  it("does not attach an unavailable target to an unrelated message and resolves after older history loads", () => {
    const partial = project(messageHistoryEvents.slice(3));
    expect(partial.presentations.get("quoted:received:user")?.reply).toEqual({
      text: "Earlier message",
      image: undefined,
      targetId: undefined,
    });
    expect(
      partial.presentations.get("latest:received:user")?.reactions
    ).toEqual(["👩🏽‍💻"]);
    expect(partial.handledReactionCallIds.has("like-old")).toBe(true);
    expect(project().handledReactionCallIds.has("like-old")).toBe(true);
  });

  it("ignores failed results and does not duplicate a repeated add", () => {
    const failed = historyToolResult(
      "latest",
      "failed-like",
      "react_to_message",
      { messageId: firstNativeMessageId, emoji: "❤️", operation: "add" },
      "failed"
    );
    const repeated = historyToolResult(
      "latest",
      "repeat-like",
      "react_to_message",
      { messageId: firstNativeMessageId, emoji: "👍", operation: "add" }
    );
    expect(
      project([...messageHistoryEvents, failed, repeated]).presentations.get(
        "photos:received:user"
      )?.reactions
    ).toEqual(["👍"]);
  });
});

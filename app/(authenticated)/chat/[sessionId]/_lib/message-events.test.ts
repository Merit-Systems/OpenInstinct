import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import {
  imessageTimestamps,
  messageTimestamps,
  sentMessages,
} from "./message-events";

type ToolResultOutput = Extract<
  Extract<MessageStreamEvent, { type: "action.result" }>["data"]["result"],
  { kind: "tool-result" }
>["output"];

describe("iMessage event projection", () => {
  it("projects only successful send_message results", () => {
    const events = [
      completedMessage("Internal terminal output", "2026-09-01T12:00:00.000Z"),
      toolResult("web_search", { answer: "Internal search result" }, 1),
      toolResult(
        "send_message",
        {
          attachments: [
            {
              kind: "image",
              name: "result.png",
              url: "https://example.com/result.png",
            },
          ],
          kind: "message",
          text: "Here is the user-visible result.",
        },
        2,
        "2026-09-01T12:00:02.000Z"
      ),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      {
        id: "turn-1:assistant:call-send_message",
        parts: [
          {
            state: "done",
            stepIndex: 2,
            text: "Here is the user-visible result.",
            type: "text",
          },
          {
            filename: "result.png",
            mediaType: "image/*",
            stepIndex: 2,
            type: "file",
            url: "https://example.com/result.png",
          },
        ],
        timestamp: "2026-09-01T12:00:02.000Z",
      },
    ]);
    expect(messageTimestamps(events).get("turn-1:assistant")).toBe(
      "2026-09-01T12:00:00.000Z"
    );
    expect(imessageTimestamps(events).has("turn-1:assistant")).toBe(false);
  });

  it("projects a compact reaction for the Eve chat", () => {
    const events = [
      toolResult("react_to_message", { operation: "add", type: "heart" }),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      expect.objectContaining({
        id: "turn-1:assistant:call-react_to_message",
        parts: [expect.objectContaining({ text: "❤️" })],
      }),
    ]);
    expect(imessageTimestamps(events).has("turn-1:assistant")).toBe(false);
  });

  it("does not project a removed reaction as a new message", () => {
    const events = [
      toolResult("react_to_message", { operation: "remove", type: "heart" }),
    ];

    expect(sentMessages(events).has("turn-1:assistant")).toBe(false);
  });

  it("projects a native link-preview send as its URL", () => {
    const events = [
      toolResult(
        "send_message",
        { kind: "link", url: "https://example.com/article" },
        1,
        "2026-09-01T12:00:01.000Z"
      ),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      {
        id: "turn-1:assistant:call-send_message",
        parts: [
          {
            state: "done",
            stepIndex: 1,
            text: "https://example.com/article",
            type: "text",
          },
        ],
        timestamp: "2026-09-01T12:00:01.000Z",
      },
    ]);
  });

  it("keeps plain-text line breaks visible in the chat view", () => {
    const events = [
      toolResult(
        "send_message",
        { kind: "message", text: "line one\nline two" },
        1,
        "2026-09-01T12:00:01.000Z",
        "completed",
        "call-lines"
      ),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      expect.objectContaining({
        parts: [expect.objectContaining({ text: "line one  \nline two" })],
      }),
    ]);
  });

  it("treats reply association as transport metadata in the Eve chat", () => {
    const events = [
      toolResult(
        "send_message",
        {
          kind: "message",
          replyTo: { kind: "current" },
          text: "This is still a normal Eve message.",
        },
        1
      ),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      expect.objectContaining({
        parts: [
          expect.objectContaining({
            text: "This is still a normal Eve message.",
          }),
        ],
      }),
    ]);
  });

  it("keeps consecutive sends in the same turn as separate messages", () => {
    const events = [
      toolResult(
        "send_message",
        { kind: "message", text: "The useful result." },
        1,
        "2026-09-01T12:00:01.000Z",
        "completed",
        "call-result"
      ),
      toolResult(
        "send_message",
        { kind: "message", text: "Want me to book it?" },
        2,
        "2026-09-01T12:00:02.000Z",
        "completed",
        "call-question"
      ),
    ];

    expect(sentMessages(events).get("turn-1:assistant")).toEqual([
      expect.objectContaining({
        id: "turn-1:assistant:call-result",
        parts: [expect.objectContaining({ text: "The useful result." })],
      }),
      expect.objectContaining({
        id: "turn-1:assistant:call-question",
        parts: [expect.objectContaining({ text: "Want me to book it?" })],
      }),
    ]);
  });

  it.each(["failed", "rejected"] as const)(
    "ignores %s send_message results",
    (status) => {
      const events = [
        toolResult(
          "send_message",
          { kind: "message", text: "This was not delivered." },
          0,
          "2026-09-01T12:00:01.000Z",
          status
        ),
      ];

      expect(sentMessages(events).has("turn-1:assistant")).toBe(false);
      expect(imessageTimestamps(events).has("turn-1:assistant")).toBe(false);
    }
  );
});

function toolResult(
  toolName: string,
  output: ToolResultOutput,
  stepIndex = 0,
  at = "2026-09-01T12:00:01.000Z",
  status: Extract<
    MessageStreamEvent,
    { type: "action.result" }
  >["data"]["status"] = "completed",
  callId = `call-${toolName}`
): MessageStreamEvent {
  return {
    data: {
      result: {
        callId,
        kind: "tool-result",
        output,
        toolName,
      },
      sequence: stepIndex,
      status,
      stepIndex,
      turnId: "turn-1",
    },
    meta: { at, id: `event-${toolName}` },
    type: "action.result",
  };
}

function completedMessage(message: string, at: string): MessageStreamEvent {
  return {
    data: {
      finishReason: "stop",
      message,
      sequence: 0,
      stepIndex: 0,
      turnId: "turn-1",
    },
    meta: { at, id: "event-message" },
    type: "message.completed",
  };
}

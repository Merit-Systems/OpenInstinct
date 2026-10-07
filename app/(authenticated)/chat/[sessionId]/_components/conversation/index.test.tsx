import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatConversation } from ".";
import type { ChatAgent } from "../chat-agent";
import { sendMessageOutputSchema } from "@shared/chat/message-delivery";

describe("chat conversation", () => {
  it.each([
    "Please keep *literal stars* in the filename.",
    "Save the `draft` filename.",
    "#42 is my order number.",
    "1. First note\n2. Second note",
    "Line one  \nLine two",
  ])("renders delivered plain text exactly: %s", async (text) => {
    const agent = await deliveredAgent(text);
    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );
    expect(markup).toContain(text);
    expect(markup).not.toMatch(/<(?:em|code|ol|h1)[ >]/u);
  });

  it.each([
    "https://example.com/report",
    "See https://example.com/report_2026?view=notes for details.",
  ])("keeps delivered HTTP URLs tappable: %s", async (text) => {
    const markup = renderToStaticMarkup(
      <ChatConversation
        agent={await deliveredAgent(text)}
        traceView="imessage"
      />
    );
    expect(markup).toContain('data-streamdown="link"');
    expect(markup).toContain("https://example.com/report");
    expect(markup).toContain(
      text.startsWith("See ") ? "for details." : "https://example.com/report"
    );
  });

  it("keeps intentional trace Markdown", () => {
    const agent = {
      data: { messages: [message("turn-1:user", "*trace emphasis*")] },
      error: undefined,
      events: [],
      respond: async () => undefined,
      status: "ready",
    } satisfies Pick<
      ChatAgent,
      "data" | "error" | "events" | "respond" | "status"
    >;
    expect(
      renderToStaticMarkup(<ChatConversation agent={agent} traceView="trace" />)
    ).toContain("<em>trace emphasis</em>");
  });

  it("shows send_message output instead of assistant stream text", () => {
    const agent = {
      data: {
        messages: [
          message("turn-1:user", "What happened?"),
          {
            id: "turn-1:assistant",
            metadata: { status: "complete", turnId: "turn-1" },
            parts: [
              {
                state: "done",
                stepIndex: 0,
                text: "Internal assistant narration",
                type: "text",
              },
              {
                state: "done",
                stepIndex: 1,
                text: "DELIVERY_COMPLETE",
                type: "text",
              },
            ],
            role: "assistant",
          },
        ],
      },
      error: undefined,
      events: [sendMessageResult("The visible iMessage response.")],
      respond: async () => undefined,
      status: "ready",
    } satisfies Pick<
      ChatAgent,
      "data" | "error" | "events" | "respond" | "status"
    >;

    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );

    expect(markup).toContain("What happened?");
    expect(markup).toContain("The visible iMessage response.");
    expect(markup).not.toContain("Internal assistant narration");
    expect(markup).not.toContain("DELIVERY_COMPLETE");
  });

  it("keeps the previous visible message while a filtered assistant shell is pending", () => {
    const cancellationText =
      "Background task task_worker (browser-agent) is cancelled.";
    const visibleMessage = message("visible-turn:user", "Keep this visible");
    const hiddenDelivery = message("task-delivery:user", cancellationText);
    const hiddenShell = {
      id: "task-delivery:assistant",
      metadata: { status: "streaming", turnId: "task-delivery" },
      parts: [{ type: "step-start" }],
      role: "assistant",
    } satisfies EveMessage;
    const events = [
      workerReceipt("task_worker"),
      workerCancellation("task_worker"),
      delivery("task-delivery", cancellationText),
    ];
    const agent = {
      data: { messages: [visibleMessage, hiddenDelivery, hiddenShell] },
      error: undefined,
      events,
      respond: async () => undefined,
      status: "streaming",
    } satisfies Pick<
      ChatAgent,
      "data" | "error" | "events" | "respond" | "status"
    >;

    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );

    expect(markup).toContain("Keep this visible");
    expect(markup).not.toContain("Thinking");
    expect(markup).not.toContain("is cancelled");
  });

  it("hides runtime errors from the iMessage transcript", () => {
    const agent = {
      data: { messages: [message("turn-1:user", "Try this")] },
      error: new Error("Internal runtime failure"),
      events: [],
      respond: async () => undefined,
      status: "error",
    } satisfies Pick<
      ChatAgent,
      "data" | "error" | "events" | "respond" | "status"
    >;

    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );

    expect(markup).toContain("Try this");
    expect(markup).not.toContain("Request failed");
    expect(markup).not.toContain("Internal runtime failure");
  });
});

async function deliveredAgent(text: string) {
  const output = sendMessageOutputSchema.parse({ kind: "message", text });
  return {
    data: {
      messages: [
        { id: "turn-1:assistant", parts: [], role: "assistant" as const },
      ],
    },
    error: undefined,
    events: [
      {
        data: {
          result: {
            callId: "call-plain",
            kind: "tool-result" as const,
            output,
            toolName: "send_message",
          },
          sequence: 0,
          status: "completed" as const,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-10-07T00:00:00.000Z", id: "event-plain" },
        type: "action.result" as const,
      },
    ],
    respond: async () => undefined,
    status: "ready" as const,
  } satisfies Pick<
    ChatAgent,
    "data" | "error" | "events" | "respond" | "status"
  >;
}

function message(id: string, text: string): EveMessage {
  return {
    id,
    metadata: { status: "complete", turnId: id.split(":")[0] },
    parts: [{ state: "done", text, type: "text" }],
    role: "user",
  };
}

function workerReceipt(taskId: string): MessageStreamEvent {
  return {
    data: {
      backgroundTask: { status: "working", taskId },
      callId: "call_worker",
      output: `{"status":"working","taskId":"${taskId}"}`,
      subagentName: "browser-agent",
    },
    meta: { at: "2026-08-27T20:00:00.000Z", id: "receipt" },
    type: "subagent.completed",
  };
}

function workerCancellation(taskId: string): MessageStreamEvent {
  return {
    data: {
      result: {
        callId: "call_cancel",
        kind: "tool-result",
        output: {
          tasks: [
            {
              metadata: {
                agentId: "agent_worker",
                kind: "subagent",
                mode: "local",
                name: "browser-agent",
              },
              status: "cancelled",
              taskId,
            },
          ],
        },
        toolName: "task_cancel",
      },
      sequence: 2,
      status: "completed",
      stepIndex: 1,
      turnId: "turn_cancel",
    },
    meta: { at: "2026-08-27T20:00:00.500Z", id: "cancel-result" },
    type: "action.result",
  };
}

function delivery(turnId: string, messageText: string): MessageStreamEvent {
  return {
    data: { message: messageText, sequence: 0, turnId },
    meta: { at: "2026-08-27T20:00:01.000Z", id: "delivery" },
    type: "message.received",
  };
}

function sendMessageResult(text: string): MessageStreamEvent {
  return {
    data: {
      result: {
        callId: "call_send_message",
        kind: "tool-result",
        output: { kind: "message", text },
        toolName: "send_message",
      },
      sequence: 1,
      status: "completed",
      stepIndex: 1,
      turnId: "turn-1",
    },
    meta: { at: "2026-09-01T20:00:00.000Z", id: "send-result" },
    type: "action.result",
  };
}

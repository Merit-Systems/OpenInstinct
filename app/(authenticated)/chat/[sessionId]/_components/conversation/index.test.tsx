import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatConversation } from ".";
import type { ChatAgent } from "../chat-agent";
import { defaultMessageReducer } from "eve/client";
import { messageHistoryEvents } from "@tests/fixtures/message-history";

describe("chat conversation", () => {
  it("renders new provider history, attachments, quoted parts, and targeted reactions", () => {
    const reducer = defaultMessageReducer();
    const data = messageHistoryEvents.reduce(
      (state, event) => reducer.reduce(state, event),
      reducer.initial()
    );
    const agent = {
      data,
      events: messageHistoryEvents,
      error: undefined,
      respond: async () => undefined,
      status: "ready" as const,
    };
    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );
    expect(markup).toContain("Here are two photos.");
    expect(markup).toContain('aria-label="Open orange.svg"');
    expect(markup).toContain('aria-label="Open blue.svg"');
    expect(markup).toContain('aria-label="Reply to blue.svg"');
    expect(markup).toContain('href="#photos%3Areceived%3Auser"');
    expect(markup).toContain('aria-label="Reaction 👍"');
    expect(markup).toContain('aria-label="Reaction 👩🏽‍💻"');
    expect(markup).toContain('aria-label="Reaction ❤️"');
    expect(markup).not.toContain('aria-label="Reaction 👀"');
    expect(markup).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(markup).toContain("literal-parts-example");
    expect(markup).not.toContain("opaque-app-payload");
    expect(markup).toContain("example");
    const trace = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="trace" />
    );
    expect(trace).toContain("[Parts:");
    expect(trace).toContain("opaque-app-payload");
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

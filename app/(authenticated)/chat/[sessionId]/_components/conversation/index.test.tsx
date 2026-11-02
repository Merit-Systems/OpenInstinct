import type { SessionEvent, SessionStreamEvent } from "eve/client";
import { emptySessionView, foldEvents, type JsonValue } from "eve/events";
import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatConversation } from ".";
import type { ChatAgent } from "../chat-agent";

type ConversationAgent = Pick<
  ChatAgent,
  "error" | "events" | "messages" | "respond" | "status" | "view"
>;

describe("chat conversation", () => {
  it("shows send_message output instead of assistant stream text", () => {
    const events = settledCall("call_send_message", "send_message", {
      kind: "message",
      text: "The visible iMessage response.",
    });
    const agent = {
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
      error: undefined,
      events,
      respond: async () => undefined,
      status: "ready",
      view: viewOf(events),
    } satisfies ConversationAgent;

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
      parts: [],
      role: "assistant",
    } satisfies EveMessage;
    const events = [
      ...settledCall(
        "call_worker",
        "browser-agent",
        { agentId: "agent_worker", status: "working", taskId: "task_worker" },
        "agent"
      ),
      ...settledCall("call_cancel", "task_cancel", {
        tasks: [
          {
            metadata: { name: "browser-agent" },
            status: "cancelled",
            taskId: "task_worker",
          },
        ],
      }),
      delivery("task-delivery", cancellationText),
    ];
    const agent = {
      error: undefined,
      events,
      messages: [visibleMessage, hiddenDelivery, hiddenShell],
      respond: async () => undefined,
      status: "streaming",
      view: viewOf(events),
    } satisfies ConversationAgent;

    const markup = renderToStaticMarkup(
      <ChatConversation agent={agent} traceView="imessage" />
    );

    expect(markup).toContain("Keep this visible");
    expect(markup).not.toContain("Thinking");
    expect(markup).not.toContain("is cancelled");
  });

  it("hides runtime errors from the iMessage transcript", () => {
    const agent = {
      error: new Error("Internal runtime failure"),
      events: [],
      messages: [message("turn-1:user", "Try this")],
      respond: async () => undefined,
      status: "error",
      view: emptySessionView(),
    } satisfies ConversationAgent;

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

function settledCall(
  callId: string,
  name: string,
  output: JsonValue,
  kind: "agent" | "tool" = "tool"
) {
  const scope = { runId: `run_${callId}`, turnId: "turn-1" };
  return [
    streamed({
      data: { owner: { turnId: scope.turnId }, runId: scope.runId },
      scope,
      type: "model.requested",
    }),
    streamed({
      data: {
        callId,
        capability: { kind, name },
        input: {},
        owner: { runId: scope.runId },
      },
      scope,
      type: "call.requested",
    }),
    streamed({
      data: { callId, outcome: "completed", output },
      scope,
      type: "call.settled",
    }),
  ];
}

function delivery(name: string, text: string) {
  return streamed({
    data: { deliveryId: name, parts: [{ kind: "text", text }], turnId: name },
    scope: { turnId: name },
    type: "delivery.consumed",
  });
}

let nextLine = 0;

function streamed(fact: SessionEvent): SessionStreamEvent {
  const line = nextLine;
  nextLine += 1;
  return {
    ...fact,
    meta: {
      at: "2026-08-27T20:00:00.000Z",
      endOfLine: true,
      position: { index: 0, line },
    },
  };
}

function viewOf(events: readonly SessionStreamEvent[]) {
  return foldEvents(emptySessionView(), events);
}

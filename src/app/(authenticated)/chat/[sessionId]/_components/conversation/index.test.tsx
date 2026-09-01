import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatConversation } from ".";
import type { ChatAgent } from "../chat-agent";

describe("chat conversation", () => {
  it("keeps the previous visible message while a filtered assistant shell is pending", () => {
    const cancellationText =
      "Background task task_worker (worker) is cancelled.";
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
    expect(markup).toContain("Thinking");
    expect(markup).not.toContain("is cancelled");
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
      subagentName: "worker",
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
                name: "worker",
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

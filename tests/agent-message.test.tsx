import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  backgroundWorkerDeliveryMessageIds,
  messagesForTraceView,
} from "../app/_components/agent-chat";
import { AgentMessage } from "../app/_components/agent-message";
import { getLatestTurnFailure } from "../app/_lib/turn-failure";

describe("agent messages", () => {
  it.each([
    ["update", "update: Checking availability", false],
    ["input", "needs input.", false],
    ["cancelled", "is cancelled.", true],
    [
      "completed",
      'is completed.\n\nResult:\n{"status":"success","message":"Done"}',
      false,
    ],
    ["failed", 'failed.\n\nError:\n{"message":"Worker failed"}', false],
  ])(
    "identifies a worker task %s delivery",
    (_label, notification, hidesResponse) => {
      const events = [
        {
          data: {
            backgroundTask: { status: "working", taskId: "task_worker" },
            callId: "call_worker",
            output: '{"status":"working","taskId":"task_worker"}',
            subagentName: "worker",
          },
          meta: { at: "2026-08-27T20:00:00.000Z", id: "receipt" },
          type: "subagent.completed",
        },
        ...(hidesResponse ? [workerCancellationResult("task_worker")] : []),
        {
          data: {
            message: `Background task task_worker (worker) ${notification}`,
            sequence: 0,
            turnId: "task-delivery",
          },
          meta: { at: "2026-08-27T20:00:01.000Z", id: "delivery" },
          type: "message.received",
        },
      ] satisfies MessageStreamEvent[];

      expect(backgroundWorkerDeliveryMessageIds(events)).toEqual(
        new Set([
          "task-delivery:user",
          ...(hidesResponse ? ["task-delivery:assistant"] : []),
        ])
      );
    }
  );

  it("identifies authorization delivery for a known worker task", () => {
    const events = [
      workerActionReceipt("task_worker"),
      receivedMessage(
        "task-delivery",
        "Background task task_worker needs authorization."
      ),
    ] satisfies MessageStreamEvent[];

    expect(backgroundWorkerDeliveryMessageIds(events)).toEqual(
      new Set(["task-delivery:user"])
    );
  });

  it("hides task deliveries only in the iMessage projection", () => {
    const deliveryText = "Background task task_worker (worker) is cancelled.";
    const ordinaryText =
      "Background task task_someone_else (worker) is cancelled.";
    const events = [
      workerActionReceipt("task_worker"),
      workerCancellationResult("task_worker"),
      receivedMessage("task-delivery", deliveryText),
      receivedMessage("ordinary-user-message", ordinaryText),
    ] satisfies MessageStreamEvent[];
    const messages = [
      userMessage("task-delivery", deliveryText),
      userMessage("ordinary-user-message", ordinaryText),
      assistantMessage("task-delivery", "Here is the useful result."),
    ];

    expect(messagesForTraceView(messages, events, "imessage")).toEqual([
      messages[1],
    ]);
    expect(messagesForTraceView(messages, events, "trace")).toBe(messages);
  });

  it("keeps identical user-authored cancellation text visible", () => {
    const text = "Background task task_worker (worker) is cancelled.";
    const events = [
      workerActionReceipt("task_worker"),
      receivedMessage("user-spoof", text),
      workerCancellationResult("task_worker"),
      receivedMessage("framework-delivery", text),
    ] satisfies MessageStreamEvent[];
    const messages = [
      userMessage("user-spoof", text),
      assistantMessage("user-spoof", "Visible reply"),
      userMessage("framework-delivery", text),
      assistantMessage("framework-delivery", "Hidden redundant reply"),
    ];

    expect(messagesForTraceView(messages, events, "imessage")).toEqual(
      messages.slice(0, 2)
    );
  });

  it("renders ordinary assistant text without a delivery tool result", () => {
    const message = {
      id: "assistant-message",
      metadata: { status: "complete" },
      parts: [
        {
          state: "done",
          text: "Hello from ordinary assistant output.",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
      />
    );

    expect(markup).toContain("Hello from ordinary assistant output.");
  });

  it("renders only Linq-delivered content in the iMessage view", () => {
    const message = {
      id: "turn-1:assistant",
      metadata: { status: "complete", turnId: "turn-1" },
      parts: [
        {
          state: "done",
          stepIndex: 1,
          text: "I’ll check that now.",
          type: "text",
        },
        {
          state: "done",
          stepIndex: 0,
          text: "Private reasoning",
          type: "reasoning",
        },
        {
          input: { query: "example" },
          output: { result: "internal" },
          state: "output-available",
          stepIndex: 0,
          toolCallId: "call-1",
          toolName: "web_search",
          type: "dynamic-tool",
        },
        {
          state: "done",
          stepIndex: 1,
          text: "Here’s what I found.",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        deliveredAssistantMessages={new Map([[1, ["Here’s what I found."]]])}
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
        userVisibleOnly
      />
    );

    expect(markup).toContain("Here’s what I found.");
    expect(markup).not.toContain("I’ll check that now.");
    expect(markup).not.toContain("Private reasoning");
    expect(markup).not.toContain("web_search");
  });

  it("shows approval controls without the hidden tool trace", () => {
    const message = {
      id: "turn-2:assistant",
      metadata: { status: "streaming", turnId: "turn-2" },
      parts: [
        {
          approval: { id: "approval-1" },
          input: { amount: 50, recipient: "Hidden recipient" },
          state: "approval-requested",
          stepIndex: 0,
          toolCallId: "call-2",
          toolMetadata: {
            eve: {
              inputRequest: {
                kind: "tool-approval",
                options: [
                  { id: "approve", label: "Approve", style: "primary" },
                  { id: "cancel", label: "Cancel", style: "danger" },
                ],
                prompt: "Approve this action?",
                requestId: "approval-1",
              },
              kind: "tool-call",
              name: "send_payment",
            },
          },
          toolName: "send_payment",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;

    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
        userVisibleOnly
      />
    );

    expect(markup).toContain("Approve this action?");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("send_payment");
    expect(markup).not.toContain("Hidden recipient");
  });

  it("keeps a parked failed child visibly failed", () => {
    const events = [
      {
        data: {
          code: "CHILD_FAILED",
          message: "Child failed.",
          sequence: 1,
          turnId: "child-turn",
        },
        meta: { at: "2026-08-27T20:00:00.000Z", id: "failed" },
        type: "turn.failed",
      },
      {
        data: { continuationToken: "", wait: "next-user-message" },
        meta: { at: "2026-08-27T20:00:01.000Z", id: "waiting" },
        type: "session.waiting",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe("Child failed.");
  });
});

function workerActionReceipt(taskId: string): MessageStreamEvent {
  return {
    data: {
      result: {
        backgroundTask: { status: "working", taskId },
        callId: "call_worker",
        kind: "subagent-result",
        origin: "child",
        outcome: {
          kind: "parked",
          result: {
            kind: "succeeded",
            output: { agentId: "agent_worker", status: "working", taskId },
          },
          usageDelta: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            inputTokens: 1,
            outputTokens: 1,
          },
        },
        output: { agentId: "agent_worker", status: "working", taskId },
        subagentName: "worker",
      },
      sequence: 1,
      status: "completed",
      stepIndex: 0,
      turnId: "turn_worker",
    },
    meta: { at: "2026-08-27T20:00:00.000Z", id: "worker-receipt" },
    type: "action.result",
  };
}

function workerCancellationResult(taskId: string): MessageStreamEvent {
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

function receivedMessage(turnId: string, message: string): MessageStreamEvent {
  return {
    data: { message, sequence: 0, turnId },
    meta: { at: "2026-08-27T20:00:01.000Z", id: `event-${turnId}` },
    type: "message.received",
  };
}

function userMessage(turnId: string, text: string): EveMessage {
  return {
    id: `${turnId}:user`,
    metadata: { status: "complete", turnId },
    parts: [{ state: "done", text, type: "text" }],
    role: "user",
  };
}

function assistantMessage(turnId: string, text: string): EveMessage {
  return {
    id: `${turnId}:assistant`,
    metadata: { status: "complete", turnId },
    parts: [{ state: "done", stepIndex: 0, text, type: "text" }],
    role: "assistant",
  };
}

import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import {
  backgroundWorkerDeliveryMessageIds,
  hasPendingBackgroundWorker,
  messagesForTraceView,
} from "./trace-view";

describe("trace view", () => {
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
        workerCompletedReceipt("task_worker"),
        ...(hidesResponse ? [workerCancellationResult("task_worker")] : []),
        receivedMessage(
          "task-delivery",
          `Background task task_worker (browser-agent) ${notification}`
        ),
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
    const deliveryText =
      "Background task task_worker (browser-agent) is cancelled.";
    const ordinaryText =
      "Background task task_someone_else (browser-agent) is cancelled.";
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
    const text = "Background task task_worker (browser-agent) is cancelled.";
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

  it("tracks a worker only between its receipt and terminal delivery", () => {
    const receipt = workerActionReceipt("task_worker");
    const update = receivedMessage(
      "task-update",
      "Background task task_worker (browser-agent) update: Still working"
    );
    const completed = receivedMessage(
      "task-completed",
      'Background task task_worker (browser-agent) is completed.\n\nResult:\n{"message":"Done"}'
    );

    expect(hasPendingBackgroundWorker([receipt])).toBe(true);
    expect(hasPendingBackgroundWorker([receipt, update])).toBe(true);
    expect(hasPendingBackgroundWorker([receipt, update, completed])).toBe(
      false
    );
  });
});

function workerCompletedReceipt(taskId: string): MessageStreamEvent {
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
        subagentName: "browser-agent",
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

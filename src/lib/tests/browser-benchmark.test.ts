import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { didCompleteWorker, didFinishWorker } from "@/lib/worker-events";

type ActionResultEvent = Extract<MessageStreamEvent, { type: "action.result" }>;
type SubagentResult = Extract<
  ActionResultEvent["data"]["result"],
  { kind: "subagent-result"; origin: "child" }
>;

function completedWorkerNotification(output: {
  readonly message: string;
  readonly status: "failure" | "success";
}) {
  return {
    data: {
      message: `Background task task_worker (worker) is completed.\n\nResult:\n${JSON.stringify(output)}`,
      sequence: 0,
      turnId: "turn_0",
    },
    meta: { at: "2026-08-27T18:00:01.000Z", id: "evt_notification" },
    type: "message.received",
  } satisfies MessageStreamEvent;
}

function terminalWorkerNotification(message: string) {
  return {
    data: {
      message: `Background task task_worker (worker) ${message}`,
      sequence: 0,
      turnId: "turn_0",
    },
    meta: { at: "2026-08-27T18:00:01.000Z", id: "evt_notification" },
    type: "message.received",
  } satisfies MessageStreamEvent;
}

function completedWorkerResult(
  output: SubagentResult["output"],
  backgroundTask?: SubagentResult["backgroundTask"]
) {
  return {
    data: {
      result: {
        backgroundTask,
        callId: "call_worker",
        kind: "subagent-result",
        origin: "child",
        outcome: {
          kind: "parked",
          result: { kind: "succeeded", output },
          usageDelta: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            inputTokens: 1,
            outputTokens: 1,
          },
        },
        output,
        subagentName: "worker",
      },
      sequence: 0,
      status: "completed",
      stepIndex: 0,
      turnId: "turn_0",
    },
    meta: { at: "2026-08-27T18:00:00.000Z", id: "evt_worker" },
    type: "action.result",
  } satisfies ActionResultEvent;
}

describe("browser benchmark event detection", () => {
  it("recognizes a successful inline subagent result", () => {
    expect(
      didCompleteWorker([
        completedWorkerResult({
          message: "Browser assignment completed.",
          status: "success",
        }),
      ])
    ).toBe(true);
  });

  it("waits for a background worker's native task notification", () => {
    const receipt = completedWorkerResult(
      { agentId: "agent_worker", status: "working", taskId: "task_worker" },
      { status: "working", taskId: "task_worker" }
    );
    const initialTurn = [receipt];
    const terminalTurn = [
      completedWorkerNotification({
        message: "Browser assignment completed.",
        status: "success",
      }),
    ];

    expect(didCompleteWorker(initialTurn)).toBe(false);
    expect(didCompleteWorker([...initialTurn, ...terminalTurn])).toBe(true);
  });

  it("treats a structured worker failure as terminal but unsuccessful", () => {
    const receipt = completedWorkerResult(
      { agentId: "agent_worker", status: "working", taskId: "task_worker" },
      { status: "working", taskId: "task_worker" }
    );
    const events = [
      receipt,
      completedWorkerNotification({
        message: "Browser assignment failed.",
        status: "failure",
      }),
    ];

    expect(didFinishWorker(events)).toBe(true);
    expect(didCompleteWorker(events)).toBe(false);
  });

  it.each(["failed.\n\nError:\nWorker failed.", "is cancelled."])(
    "treats a native %s notification as terminal",
    (notification) => {
      const receipt = completedWorkerResult(
        { agentId: "agent_worker", status: "working", taskId: "task_worker" },
        { status: "working", taskId: "task_worker" }
      );
      const initialTurn = [receipt];
      const terminalTurn = [terminalWorkerNotification(notification)];
      const events = [...initialTurn, ...terminalTurn];

      expect(didFinishWorker(events)).toBe(true);
      expect(didCompleteWorker(events)).toBe(false);
    }
  );
});

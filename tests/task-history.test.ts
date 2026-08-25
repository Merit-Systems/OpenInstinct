import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { taskFromHistoryRun, type TaskHistoryRun } from "../lib/task-history";

const run: TaskHistoryRun = {
  createdAt: "2026-08-25T20:00:00.000Z",
  prompt: "Get Spider-Man tickets tonight",
  sessionId: "wrun_test",
  status: "running",
  updatedAt: "2026-08-25T20:00:08.000Z",
};

describe("durable task history", () => {
  it("rebuilds success, duration, cost, and terminal message from a session stream", () => {
    const events = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          finishReason: "tool-calls",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn_0",
          usage: { costUsd: 0.0125 },
        },
        meta: { at: "2026-08-25T20:00:07.000Z", id: "evt_step" },
        type: "step.completed",
      },
      {
        data: {
          result: {
            callId: "call_1",
            kind: "tool-result",
            output: {
              message: "Found the 8:15 PM showing.",
              status: "success",
            },
            toolName: "complete_task",
          },
          sequence: 1,
          status: "completed",
          stepIndex: 0,
          turnId: "turn_0",
        },
        meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_complete" },
        type: "action.result",
      },
    ] satisfies readonly MessageStreamEvent[];
    const task = taskFromHistoryRun(run, events);

    expect(task).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:08.000Z").getTime(),
      costComplete: true,
      costUsd: 0.0125,
      durationMs: 7_000,
      status: "success",
      terminalMessage: "Found the 8:15 PM showing.",
    });
  });

  it("marks a settled run without complete_task as a failure", () => {
    const events = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          finishReason: "stop",
          message: "I stopped before completion.",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn_0",
        },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_message" },
        type: "message.completed",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ] satisfies readonly MessageStreamEvent[];
    const task = taskFromHistoryRun(run, events);

    expect(task).toMatchObject({
      status: "failure",
      terminalMessage: "I stopped before completion.",
    });
  });
});

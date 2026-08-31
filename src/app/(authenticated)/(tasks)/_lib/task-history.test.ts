import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import type { TaskHistoryRun } from "@/app/(authenticated)/(tasks)/_lib/task-history";
import { taskFromHistoryRun } from "./task-history";

const run: TaskHistoryRun = {
  createdAt: "2026-08-25T20:00:00.000Z",
  prompt: "Get Spider-Man tickets tonight",
  sessionId: "wrun_test",
  status: "running",
  updatedAt: "2026-08-25T20:00:08.000Z",
};

describe("durable task history", () => {
  it("rebuilds success, duration, cost, and terminal message from a session stream", () => {
    const events: readonly MessageStreamEvent[] = [
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
          callId: "call_worker",
          output: JSON.stringify({
            message: "Found the 8:15 PM showing.",
            status: "success",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_complete" },
        type: "subagent.completed",
      },
    ];
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

  it("marks a settled run without worker completion as a failure", () => {
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

  it.each([
    ["completed", "success"],
    ["failed", "failure"],
    ["cancelled", "failure"],
    ["pending", "queued"],
    ["running", "running"],
  ] as const)(
    "preserves the durable %s status when its event stream is unavailable",
    (status, expected) => {
      expect(taskFromHistoryRun({ ...run, status }, [])).toHaveProperty(
        "status",
        expected
      );
    }
  );
  it("rebuilds background completion from the root synthesis", () => {
    const events: readonly MessageStreamEvent[] = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          result: {
            callId: "call_worker",
            kind: "subagent-result",
            origin: "child",
            backgroundTask: {
              status: "working",
              taskId: "task_worker",
            },
            outcome: {
              kind: "parked",
              result: {
                kind: "succeeded",
                output: {
                  agentId: "agent_worker",
                  status: "working",
                  taskId: "task_worker",
                },
              },
              usageDelta: {
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                inputTokens: 1,
                outputTokens: 1,
              },
            },
            output: {
              agentId: "agent_worker",
              status: "working",
              taskId: "task_worker",
            },
            subagentName: "worker",
          },
          sequence: 1,
          status: "completed",
          stepIndex: 0,
          turnId: "turn_0",
        },
        meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_worker" },
        type: "action.result",
      },
      {
        data: {
          message:
            'Background task task_worker (worker) is completed.\n\nResult:\n{"status":"success","message":"Found the 8:15 PM showing."}',
          sequence: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:09.000Z", id: "evt_synthesis" },
        type: "message.received",
      },
      {
        data: {
          finishReason: "stop",
          message: "Found the 8:15 PM showing.",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:10.000Z", id: "evt_message" },
        type: "message.completed",
      },
    ];

    expect(taskFromHistoryRun(run, events)).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:09.000Z").getTime(),
      status: "success",
      terminalMessage: "Found the 8:15 PM showing.",
    });
  });

  it("keeps an acknowledged background worker running while it is pending", () => {
    const events: readonly MessageStreamEvent[] = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_worker" },
          callId: "call_worker",
          output: JSON.stringify({
            agentId: "agent_worker",
            status: "working",
            taskId: "task_worker",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
      {
        data: {
          finishReason: "stop",
          message: "I started the browser task.",
          sequence: 1,
          stepIndex: 0,
          turnId: "turn_0",
        },
        meta: { at: "2026-08-25T20:00:04.000Z", id: "evt_ack" },
        type: "message.completed",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ];

    expect(
      taskFromHistoryRun(
        run,
        events,
        new Date("2026-08-25T20:00:10.000Z").getTime()
      )
    ).toMatchObject({
      completedAt: undefined,
      durationMs: 9_000,
      status: "running",
      terminalMessage: undefined,
    });
  });

  it("uses the inline subagent completion timestamp", () => {
    const events: readonly MessageStreamEvent[] = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          callId: "call_worker",
          output: JSON.stringify({
            message: "Found the 8:15 PM showing.",
            status: "success",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:06.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
    ];

    expect(taskFromHistoryRun(run, events)).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:06.000Z").getTime(),
      status: "success",
      terminalMessage: "Found the 8:15 PM showing.",
    });
  });

  it("settles a cancelled background worker from task_cancel", () => {
    const events: readonly MessageStreamEvent[] = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_worker" },
          callId: "call_worker",
          output: JSON.stringify({
            agentId: "agent_worker",
            status: "working",
            taskId: "task_worker",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
      {
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
                  taskId: "task_worker",
                },
              ],
            },
            toolName: "task_cancel",
          },
          sequence: 1,
          status: "completed",
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_cancel" },
        type: "action.result",
      },
      {
        data: {
          finishReason: "stop",
          message: "I cancelled the browser task.",
          sequence: 2,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:06.000Z", id: "evt_message" },
        type: "message.completed",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:07.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ];

    expect(taskFromHistoryRun(run, events)).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:05.000Z").getTime(),
      status: "failure",
      terminalMessage: "I cancelled the browser task.",
    });
  });

  it("settles a framework-failed background worker", () => {
    const events: readonly MessageStreamEvent[] = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_worker" },
          callId: "call_worker",
          output: JSON.stringify({
            agentId: "agent_worker",
            status: "working",
            taskId: "task_worker",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
      {
        data: {
          message:
            'Background task task_worker (worker) failed.\n\nError:\n{"code":"WORKER_FAILED","message":"Worker failed."}',
          sequence: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_failed" },
        type: "message.received",
      },
      {
        data: {
          finishReason: "stop",
          message: "The browser worker failed to start.",
          sequence: 2,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:06.000Z", id: "evt_message" },
        type: "message.completed",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:07.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ];

    expect(taskFromHistoryRun(run, events)).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:05.000Z").getTime(),
      status: "failure",
      terminalMessage: "The browser worker failed to start.",
    });
  });

  it("settles Eve's native cancelled task notification", () => {
    const events = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_worker" },
          callId: "call_worker",
          output: JSON.stringify({
            agentId: "agent_worker",
            status: "working",
            taskId: "task_worker",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
      {
        data: {
          message: "Background task task_worker (worker) is cancelled.",
          sequence: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_cancelled" },
        type: "message.received",
      },
      {
        data: {
          finishReason: "stop",
          message: "The browser task was cancelled.",
          sequence: 1,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:06.000Z", id: "evt_message" },
        type: "message.completed",
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(taskFromHistoryRun(run, events)).toMatchObject({
      completedAt: new Date("2026-08-25T20:00:05.000Z").getTime(),
      status: "failure",
      terminalMessage: "The browser task was cancelled.",
    });
  });

  it("does not let an older completion settle a newer pending worker", () => {
    const events = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_first" },
          callId: "call_first",
          output: JSON.stringify({
            agentId: "agent_first",
            status: "working",
            taskId: "task_first",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:02.000Z", id: "evt_first" },
        type: "subagent.completed",
      },
      {
        data: {
          message:
            'Background task task_first (worker) is completed.\n\nResult:\n{"status":"success","message":"First task finished."}',
          sequence: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_first_done" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_second" },
          callId: "call_second",
          output: JSON.stringify({
            agentId: "agent_second",
            status: "working",
            taskId: "task_second",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:04.000Z", id: "evt_second" },
        type: "subagent.completed",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:05.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(
      taskFromHistoryRun(
        run,
        events,
        new Date("2026-08-25T20:00:10.000Z").getTime()
      )
    ).toMatchObject({
      completedAt: undefined,
      durationMs: 9_000,
      status: "running",
      terminalMessage: undefined,
    });
  });

  it("keeps a retained background worker running after turn cancellation", () => {
    const events = [
      {
        data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
        type: "message.received",
      },
      {
        data: {
          backgroundTask: { status: "working", taskId: "task_worker" },
          callId: "call_worker",
          output: JSON.stringify({
            agentId: "agent_worker",
            status: "working",
            taskId: "task_worker",
          }),
          subagentName: "worker",
        },
        meta: { at: "2026-08-25T20:00:02.000Z", id: "evt_worker" },
        type: "subagent.completed",
      },
      {
        data: { sequence: 1, turnId: "turn_0" },
        meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_cancelled" },
        type: "turn.cancelled",
      },
      {
        data: { continuationToken: "wrun_test", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:04.000Z", id: "evt_waiting" },
        type: "session.waiting",
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(
      taskFromHistoryRun(
        run,
        events,
        new Date("2026-08-25T20:00:10.000Z").getTime()
      )
    ).toMatchObject({
      completedAt: undefined,
      durationMs: 9_000,
      status: "running",
      terminalMessage: undefined,
    });
  });
});

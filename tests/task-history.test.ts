import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { taskFromHistoryRun, type TaskHistoryRun } from "../lib/task-history";
import { subagentSessionIds, type TaskSessionTree } from "../lib/task-stream";

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

  it("keeps a background task running and reports its latest native update", () => {
    const events = backgroundTaskEvents();
    const task = taskFromHistoryRun(
      run,
      events,
      Date.parse("2026-08-25T20:00:10.000Z")
    );

    expect(task).toMatchObject({
      activity: "checking the available showtimes",
      status: "running",
    });
    expect(task.completedAt).toBeUndefined();
  });

  it("discovers durable child streams from native subagent events", () => {
    const events = [
      {
        data: {
          callId: "call_agent",
          childSessionId: "wrun_child",
          childStreamPath: "/eve/v1/session/wrun_child/stream",
          name: "agent",
          sequence: 0,
          sessionId: run.sessionId,
          toolName: "agent",
          turnId: "turn_0",
          workflowId: "workflow//eve//workflowEntry",
        },
        meta: { at: "2026-08-25T20:00:02.000Z", id: "evt_child" },
        type: "subagent.called",
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(subagentSessionIds(events)).toEqual(["wrun_child"]);
  });

  it("settles a parked child that omitted its completion contract as a failure", () => {
    const parentEvents = backgroundTaskEvents();
    const childEvents = [
      {
        data: {
          finishReason: "stop",
          message: "I stopped before recording the outcome.",
          sequence: 0,
          stepIndex: 2,
          turnId: "turn_child",
        },
        meta: { at: "2026-08-25T20:00:07.000Z", id: "evt_child_message" },
        type: "message.completed",
      },
      {
        data: { continuationToken: "wrun_child", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_child_waiting" },
        type: "session.waiting",
      },
    ] satisfies readonly MessageStreamEvent[];
    const tree = {
      events: [...parentEvents, ...childEvents],
      rootSessionId: run.sessionId,
      sessions: [
        { events: parentEvents, sessionId: run.sessionId },
        { events: childEvents, sessionId: "wrun_child" },
      ],
    } satisfies TaskSessionTree;

    expect(taskFromHistoryRun(run, tree)).toMatchObject({
      status: "failure",
      terminalMessage: "I stopped before recording the outcome.",
    });
  });

  it("keeps the cohort running while a sibling child remains active", () => {
    const parentEvents = backgroundTaskEvents();
    const parkedChildEvents = [
      {
        data: { continuationToken: "wrun_child", wait: "next-user-message" },
        meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_child_waiting" },
        type: "session.waiting",
      },
    ] satisfies readonly MessageStreamEvent[];
    const activeChildEvents = [
      {
        data: { sequence: 0, turnId: "turn_active" },
        meta: { at: "2026-08-25T20:00:09.000Z", id: "evt_active_turn" },
        type: "turn.started",
      },
    ] satisfies readonly MessageStreamEvent[];
    const tree = {
      events: [...parentEvents, ...parkedChildEvents, ...activeChildEvents],
      rootSessionId: run.sessionId,
      sessions: [
        { events: parentEvents, sessionId: run.sessionId },
        { events: parkedChildEvents, sessionId: "wrun_child" },
        { events: activeChildEvents, sessionId: "wrun_sibling" },
      ],
    } satisfies TaskSessionTree;

    expect(taskFromHistoryRun(run, tree)).toMatchObject({ status: "running" });
  });
});

function backgroundTaskEvents() {
  return [
    {
      data: { message: run.prompt, sequence: 0, turnId: "turn_0" },
      meta: { at: "2026-08-25T20:00:01.000Z", id: "evt_received" },
      type: "message.received",
    },
    {
      data: {
        backgroundTask: { status: "working", taskId: "task_123" },
        callId: "call_agent",
        output: "Background task task_123 (agent) started.",
        subagentName: "agent",
      },
      meta: { at: "2026-08-25T20:00:03.000Z", id: "evt_receipt" },
      type: "subagent.completed",
    },
    {
      data: { continuationToken: run.sessionId, wait: "next-user-message" },
      meta: { at: "2026-08-25T20:00:04.000Z", id: "evt_waiting" },
      type: "session.waiting",
    },
    {
      data: {
        actions: [
          {
            callId: "call_update",
            input: { message: "checking the available showtimes" },
            kind: "tool-call",
            toolName: "task_update",
          },
        ],
        sequence: 1,
        stepIndex: 1,
        turnId: "turn_child",
      },
      meta: { at: "2026-08-25T20:00:06.000Z", id: "evt_update" },
      type: "actions.requested",
    },
  ] satisfies readonly MessageStreamEvent[];
}

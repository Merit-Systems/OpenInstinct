import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { taskFromHistoryRun, type TaskHistoryRun } from "../lib/task-history";
import { cancelTaskSessions, readTaskSessionTree } from "../lib/task-stream";
import {
  browserTaskTimeoutMs,
  remainingTaskTimeoutMs,
} from "../lib/task-timeout";

const run: TaskHistoryRun = {
  createdAt: "2026-08-25T20:00:00.000Z",
  prompt: "Get Spider-Man tickets tonight",
  sessionId: "wrun_root",
  status: "running",
  updatedAt: "2026-08-25T20:00:08.000Z",
};

describe("native Eve task streams", () => {
  it("hydrates a child completion through subagent.called", async () => {
    const client = fakeClient(
      new Map([
        [run.sessionId, [subagentCalledEvent()]],
        ["wrun_child", childCompletionEvents()],
      ])
    );

    const tree = await readTaskSessionTree(client, run.sessionId);

    expect(tree.sessions.map(({ sessionId }) => sessionId)).toEqual([
      run.sessionId,
      "wrun_child",
    ]);
    expect(taskFromHistoryRun(run, tree)).toMatchObject({
      status: "success",
      terminalMessage: "Found the 8:15 PM showing.",
    });
  });

  it("cancels each owned session once", async () => {
    const cancelled: string[] = [];
    const client = fakeClient(new Map(), cancelled);

    await cancelTaskSessions(client, ["wrun_root", "wrun_child", "wrun_child"]);

    expect(cancelled).toEqual(["wrun_root", "wrun_child"]);
  });

  it("retains only the remaining timeout after reload", () => {
    const startedAt = Date.parse("2026-08-25T20:00:00.000Z");

    expect(remainingTaskTimeoutMs(startedAt, startedAt + 60_000)).toBe(
      browserTaskTimeoutMs - 60_000
    );
    expect(
      remainingTaskTimeoutMs(startedAt, startedAt + browserTaskTimeoutMs)
    ).toBe(0);
  });
});

function fakeClient(
  streams: ReadonlyMap<string, readonly MessageStreamEvent[]>,
  cancelled: string[] = []
) {
  return {
    sessions: {
      attach(sessionId: string) {
        return {
          async cancel() {
            cancelled.push(sessionId);
          },
          async *stream() {
            for (const event of streams.get(sessionId) ?? []) yield event;
          },
        };
      },
    },
  };
}

function subagentCalledEvent(): MessageStreamEvent {
  return {
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
  };
}

function childCompletionEvents(): MessageStreamEvent[] {
  return [
    {
      data: {
        result: {
          callId: "call_complete",
          kind: "tool-result",
          output: {
            message: "Found the 8:15 PM showing.",
            status: "success",
          },
          toolName: "complete_task",
        },
        sequence: 1,
        status: "completed",
        stepIndex: 1,
        turnId: "turn_child",
      },
      meta: { at: "2026-08-25T20:00:07.000Z", id: "evt_complete" },
      type: "action.result",
    },
    {
      data: { continuationToken: "wrun_child", wait: "next-user-message" },
      meta: { at: "2026-08-25T20:00:08.000Z", id: "evt_waiting" },
      type: "session.waiting",
    },
  ];
}

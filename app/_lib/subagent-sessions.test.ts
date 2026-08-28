import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import {
  collectSubagentSessionTree,
  collectSubagentSessions,
  getSubagentStatus,
  getSubagentTask,
} from "./subagent-sessions";

const meta = { at: "2026-08-27T12:00:00.000Z", id: "evt_01" };
const called = {
  type: "subagent.called",
  data: {
    callId: "call_1",
    childSessionId: "child_1",
    childStreamPath: "/eve/v1/session/child_1/stream",
    name: "researcher",
    sequence: 0,
    sessionId: "parent_1",
    toolName: "researcher",
    turnId: "turn_1",
    workflowId: "workflow_1",
  },
  meta,
} satisfies MessageStreamEvent;

describe("collectSubagentSessions", () => {
  it("joins completions and keeps the latest call for a continued child", () => {
    const events = [
      called,
      {
        ...called,
        data: { ...called.data, callId: "call_2" },
        meta: { ...meta, id: "evt_02" },
      },
      {
        type: "subagent.completed",
        data: {
          callId: "call_2",
          output: "Done",
          subagentName: "researcher",
        },
        meta: { ...meta, id: "evt_03" },
      },
    ] satisfies readonly MessageStreamEvent[];

    const sessions = collectSubagentSessions(events);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.callId).toBe("call_2");
    expect(sessions[0]?.completion?.output).toBe("Done");
  });

  it("sorts the most recently called children first", () => {
    const events = [
      called,
      {
        ...called,
        data: {
          ...called.data,
          callId: "call_2",
          childSessionId: "child_2",
        },
        meta: { ...meta, id: "evt_02" },
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(
      collectSubagentSessions(events).map(
        ({ childSessionId }) => childSessionId
      )
    ).toEqual(["child_2", "child_1"]);
  });

  it("moves a continued child back to the front", () => {
    const secondChild = {
      ...called,
      data: {
        ...called.data,
        callId: "call_2",
        childSessionId: "child_2",
      },
      meta: { ...meta, id: "evt_02" },
    } satisfies MessageStreamEvent;
    const continuedFirstChild = {
      ...called,
      data: { ...called.data, callId: "call_3" },
      meta: { ...meta, id: "evt_03" },
    } satisfies MessageStreamEvent;

    expect(
      collectSubagentSessions([called, secondChild, continuedFirstChild]).map(
        ({ childSessionId }) => childSessionId
      )
    ).toEqual(["child_1", "child_2"]);
  });
});

describe("collectSubagentSessionTree", () => {
  it("discovers nested specialists from their parent streams", () => {
    const [coordinator] = collectSubagentSessions([called]);
    if (!coordinator) throw new Error("Expected coordinator session");

    const browserCalled = {
      ...called,
      data: {
        ...called.data,
        childSessionId: "child_2",
        childStreamPath: "/eve/v1/session/child_2/stream",
        name: "browser",
        sessionId: "child_1",
        toolName: "browser",
      },
      meta: { ...meta, id: "evt_02" },
    } satisfies MessageStreamEvent;
    const nodes = collectSubagentSessionTree(
      [coordinator],
      new Map([["child_1", [browserCalled]]])
    );

    expect(
      nodes.map(({ depth, session }) => ({
        depth,
        id: session.childSessionId,
      }))
    ).toEqual([
      { depth: 0, id: "child_1" },
      { depth: 1, id: "child_2" },
    ]);
  });
});

describe("getSubagentStatus", () => {
  it("uses the child stream instead of a background receipt", () => {
    const [session] = collectSubagentSessions([
      called,
      {
        type: "subagent.completed",
        data: {
          backgroundTask: { status: "working", taskId: "task_1" },
          callId: "call_1",
          output: "Continuing in the background",
          subagentName: "researcher",
        },
        meta: { ...meta, id: "evt_02" },
      },
    ]);

    if (!session) throw new Error("Expected a collected subagent session");

    expect(getSubagentStatus([], session)).toBe("starting");
    expect(
      getSubagentStatus(
        [
          {
            type: "turn.started",
            data: { sequence: 0, turnId: "turn_2" },
            meta: { ...meta, id: "evt_03" },
          },
        ],
        session
      )
    ).toBe("working");
  });

  it.each([
    ["turn.failed", "failed"],
    ["turn.cancelled", "cancelled"],
  ] as const)(
    "preserves %s after the session returns to waiting",
    (type, expected) => {
      const [session] = collectSubagentSessions([called]);
      if (!session) throw new Error("Expected a collected subagent session");
      const turnBoundary =
        type === "turn.failed"
          ? {
              type,
              data: {
                code: "failed",
                message: "Failed",
                sequence: 0,
                turnId: "turn_1",
              },
              meta: { ...meta, id: "evt_02" },
            }
          : {
              type,
              data: { sequence: 0, turnId: "turn_1" },
              meta: { ...meta, id: "evt_02" },
            };
      const events = [
        turnBoundary,
        {
          type: "session.waiting",
          data: {
            continuationToken: "child_1",
            wait: "next-user-message",
          },
          meta: { ...meta, id: "evt_03" },
        },
      ] satisfies readonly MessageStreamEvent[];

      expect(getSubagentStatus(events, session)).toBe(expected);
    }
  );
});

describe("getSubagentTask", () => {
  it("uses the latest task after a child session is continued", () => {
    const events = [
      {
        type: "message.received",
        data: { message: "First task", sequence: 0, turnId: "turn_1" },
        meta,
      },
      {
        type: "message.received",
        data: { message: "Continued task", sequence: 1, turnId: "turn_2" },
        meta: { ...meta, id: "evt_02" },
      },
    ] satisfies readonly MessageStreamEvent[];

    expect(getSubagentTask(events)).toBe("Continued task");
  });
});

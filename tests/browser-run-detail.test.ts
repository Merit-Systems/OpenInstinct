import type { MessageStreamEvent } from "eve/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPersistedTask } from "../lib/browser-task-runner";
import {
  createBrowserRunGroup,
  readBrowserRunGroups,
  saveBrowserRunGroup,
} from "../lib/browser-run-store";
import { browserTaskTimeoutMs } from "../lib/task-timeout";

describe("browser task recovery", () => {
  const values = new Map<string, string>();
  const now = Date.parse("2026-08-25T20:15:00.000Z");

  beforeEach(() => {
    values.clear();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubGlobal("window", {
      clearTimeout,
      dispatchEvent: vi.fn<(event: Event) => boolean>(() => true),
      document: { body: { dataset: {} } },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      setTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("cancels a resumed root and child without overwriting the timeout failure", async () => {
    const group = createBrowserRunGroup({
      concurrency: 1,
      name: "Recovered task",
      prompts: ["Book the movie tickets"],
    });
    const baseTask = group.tasks[0];
    if (!baseTask) throw new Error("Expected one browser task.");
    const task = {
      ...baseTask,
      sessionId: "wrun_root",
      startedAt: now - browserTaskTimeoutMs + 1_000,
      status: "running" as const,
    };
    saveBrowserRunGroup({ ...group, tasks: [task] });

    const childStarted = Promise.withResolvers<undefined>();
    const childCancelled = Promise.withResolvers<undefined>();
    const cancelled: string[] = [];
    const client = fakeTaskClient({
      cancelled,
      childCancelled,
      childStarted,
    });

    const runPromise = runPersistedTask(client, group.id, task);
    await childStarted.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    await runPromise;

    expect(cancelled.toSorted()).toEqual(["wrun_child", "wrun_root"]);
    expect(readBrowserRunGroups()[0]?.tasks[0]).toMatchObject({
      status: "failure",
      terminalMessage: "Timed out after 15 minutes.",
    });
  });
});

function fakeTaskClient({
  cancelled,
  childCancelled,
  childStarted,
}: {
  readonly cancelled: string[];
  readonly childCancelled: PromiseWithResolvers<undefined>;
  readonly childStarted: PromiseWithResolvers<undefined>;
}) {
  const rootEvents = [subagentCalledEvent(), sessionWaitingEvent("wrun_root")];

  return {
    sessions: {
      async create() {
        throw new Error("This recovered task must not create another session.");
      },
      attach(sessionId: string) {
        return {
          async cancel() {
            cancelled.push(sessionId);
            if (sessionId === "wrun_child") childCancelled.resolve(undefined);
          },
          async snapshot() {
            const events = sessionId === "wrun_root" ? rootEvents : [];
            return {
              events,
              session: { sessionId, streamIndex: events.length },
            };
          },
          async *stream() {
            if (sessionId !== "wrun_child") return;
            childStarted.resolve(undefined);
            await childCancelled.promise;
            yield {
              data: { sequence: 1, turnId: "turn_child" },
              meta: {
                at: "2026-08-25T20:15:00.000Z",
                id: "evt_cancelled",
              },
              type: "turn.cancelled",
            } satisfies MessageStreamEvent;
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
      sessionId: "wrun_root",
      toolName: "agent",
      turnId: "turn_0",
      workflowId: "workflow//eve//workflowEntry",
    },
    meta: { at: "2026-08-25T20:14:01.000Z", id: "evt_child" },
    type: "subagent.called",
  };
}

function sessionWaitingEvent(sessionId: string): MessageStreamEvent {
  return {
    data: { continuationToken: sessionId, wait: "next-user-message" },
    meta: { at: "2026-08-25T20:14:02.000Z", id: "evt_waiting" },
    type: "session.waiting",
  };
}

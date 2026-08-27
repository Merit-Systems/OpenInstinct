import {
  isCurrentTurnBoundaryEvent,
  type MessageStreamEvent,
} from "eve/client";
import {
  measureBrowserTask,
  readTaskCompletion,
  terminalBrowserMessage,
} from "./browser-benchmark";
import {
  type BrowserRunTask,
  type BrowserRunTaskUpdate,
  updateBrowserRunTask,
} from "./browser-run-store";
import { latestTaskUpdate } from "./task-history";
import { cancelTaskSessions, followDelegatedTaskSessions } from "./task-stream";
import { remainingTaskTimeoutMs } from "./task-timeout";

interface BrowserTaskClient {
  readonly sessions: {
    attach(
      sessionId: string,
      state: { readonly streamIndex: number }
    ): {
      cancel(): Promise<unknown>;
      snapshot(): Promise<{
        readonly events: readonly MessageStreamEvent[];
        readonly session: {
          readonly sessionId: string;
          readonly streamIndex: number;
        };
      }>;
      stream(options: {
        readonly follow?: boolean;
        readonly startIndex: number;
      }): AsyncIterable<MessageStreamEvent>;
    };
    create(input: { readonly message: string }): Promise<{
      readonly response: AsyncIterable<MessageStreamEvent> & {
        readonly sessionId: string;
      };
    }>;
  };
}

export async function runPersistedTask(
  client: BrowserTaskClient,
  groupId: string,
  task: BrowserRunTask
) {
  const requestStartedAt = task.startedAt ?? Date.now();
  const events: MessageStreamEvent[] = [];
  const activeSessionIds = new Set(task.sessionId ? [task.sessionId] : []);
  const state = { timedOut: false };

  const update = (taskUpdate: BrowserRunTaskUpdate) => {
    updateBrowserRunTask(groupId, task.id, taskUpdate);
  };
  const appendEvent = (event: MessageStreamEvent) => {
    events.push(event);
    if (event.type === "subagent.called") {
      activeSessionIds.add(event.data.childSessionId);
      if (state.timedOut) {
        void cancelTaskSessions(client, [event.data.childSessionId]);
      }
    }
    if (state.timedOut) return;
    projectTaskEvents(events, requestStartedAt, update);
  };
  const finishTimedOutTask = () => {
    if (state.timedOut) return;
    state.timedOut = true;
    update({
      activity: undefined,
      completedAt: Date.now(),
      durationMs: Math.max(task.durationMs, Date.now() - requestStartedAt),
      status: "failure",
      terminalMessage: "Timed out after 15 minutes.",
    });
    void cancelTaskSessions(client, activeSessionIds);
  };

  const remainingTimeout = remainingTaskTimeoutMs(requestStartedAt);
  if (remainingTimeout === 0) {
    finishTimedOutTask();
    return;
  }
  const timeout = setTimeout(finishTimedOutTask, remainingTimeout);

  try {
    if (task.status === "running" && task.sessionId) {
      const session = client.sessions.attach(task.sessionId, {
        streamIndex: 0,
      });
      const snapshot = await session.snapshot();
      for (const event of snapshot.events) appendEvent(event);

      const tail = snapshot.events.at(-1);
      if (!tail || !isCurrentTurnBoundaryEvent(tail)) {
        for await (const event of session.stream({
          startIndex: snapshot.session.streamIndex,
        })) {
          appendEvent(event);
          if (isCurrentTurnBoundaryEvent(event)) break;
        }
      }
    } else {
      const { response } = await client.sessions.create({
        message: task.prompt,
      });
      activeSessionIds.add(response.sessionId);
      if (state.timedOut) {
        await cancelTaskSessions(client, [response.sessionId]);
        return;
      }
      update({
        sessionId: response.sessionId,
        startedAt: requestStartedAt,
        status: "running",
      });

      for await (const event of response) appendEvent(event);
    }

    await followDelegatedTaskSessions(client, events, appendEvent);

    if (state.timedOut) return;
    completePersistedTask(events, requestStartedAt, update);
  } catch (error) {
    if (state.timedOut) return;
    const completion = readTaskCompletion(events);
    const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
    update({
      activity: undefined,
      completedAt: Date.now(),
      costComplete: metrics.costComplete,
      costUsd: metrics.costUsd,
      durationMs: metrics.durationMs,
      status: completion?.status ?? "failure",
      terminalMessage: completion?.message ?? toErrorMessage(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function projectTaskEvents(
  events: readonly MessageStreamEvent[],
  requestStartedAt: number,
  update: (taskUpdate: BrowserRunTaskUpdate) => void
) {
  const event = events.at(-1);
  if (!event || !shouldProjectEvent(event)) return;

  const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
  const completion = readTaskCompletion(events);
  update({
    activity: latestTaskUpdate(events),
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    terminalMessage: completion?.message,
  });
}

function completePersistedTask(
  events: readonly MessageStreamEvent[],
  requestStartedAt: number,
  update: (taskUpdate: BrowserRunTaskUpdate) => void
) {
  const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
  const completion = readTaskCompletion(events);
  const fallbackMessage = terminalBrowserMessage(undefined, events);
  update({
    activity: undefined,
    completedAt: Date.now(),
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    status: completion?.status ?? "failure",
    terminalMessage:
      completion?.message ??
      (fallbackMessage === "No terminal message"
        ? "Task ended without calling complete_task."
        : fallbackMessage),
  });
}

function shouldProjectEvent(event: MessageStreamEvent) {
  return (
    event.type === "message.received" ||
    event.type === "actions.requested" ||
    event.type === "action.result" ||
    event.type === "step.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.cancelled" ||
    event.type === "session.failed"
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Task failed.";
}

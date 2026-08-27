import { z } from "zod";
import {
  isCurrentTurnBoundaryEvent,
  type MessageStreamEvent,
} from "eve/client";
import {
  measureBrowserTask,
  readTaskCompletion,
  terminalBrowserMessage,
} from "./browser-benchmark";
import type { BrowserRunTask } from "./browser-run-store";
import type { TaskSessionTree } from "./task-stream";

export const taskHistoryPageSchema = z.object({
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  runs: z.array(
    z.object({
      createdAt: z.string(),
      prompt: z.string(),
      sessionId: z.string(),
      status: z.enum([
        "cancelled",
        "completed",
        "failed",
        "pending",
        "running",
      ]),
      updatedAt: z.string(),
    })
  ),
});

type TaskHistoryPage = z.infer<typeof taskHistoryPageSchema>;
export type TaskHistoryRun = TaskHistoryPage["runs"][number];

export function taskFromHistoryRun(
  run: TaskHistoryRun,
  input: readonly MessageStreamEvent[] | TaskSessionTree,
  now = Date.now()
): BrowserRunTask {
  const events = isTaskSessionTree(input) ? input.events : input;
  const rootEvents = isTaskSessionTree(input)
    ? (input.sessions.find(({ sessionId }) => sessionId === input.rootSessionId)
        ?.events ?? [])
    : events;
  const received = events.find((event) => event.type === "message.received");
  const startedAt = eventTime(received) ?? new Date(run.createdAt).getTime();
  const backgroundChildren = backgroundChildState(input);
  const hasBackgroundTask = events.some(
    (event) =>
      event.type === "subagent.completed" &&
      event.data.backgroundTask?.status === "working"
  );
  const backgroundActive =
    hasBackgroundTask && backgroundChildren?.active === true;
  const forcedBackgroundFailure =
    hasBackgroundTask &&
    backgroundChildren?.settled === true &&
    !backgroundChildren.succeeded;
  const completion =
    backgroundActive || forcedBackgroundFailure
      ? undefined
      : readTaskCompletion(events);
  const terminalFailure = rootEvents.findLast(
    (event) =>
      event.type === "turn.failed" ||
      event.type === "turn.cancelled" ||
      event.type === "session.failed"
  );
  const waiting = backgroundActive
    ? undefined
    : hasBackgroundTask
      ? (backgroundChildren?.terminalEvent ??
        events.findLast((event) => event.type === "session.completed"))
      : events.findLast(
          (event) =>
            event.type === "session.waiting" ||
            event.type === "session.completed"
        );
  const settled =
    completion !== undefined ||
    terminalFailure !== undefined ||
    waiting !== undefined;
  const terminalEvent = completion
    ? events.findLast(
        (event) =>
          event.type === "action.result" &&
          event.meta.at === completion.completedAt
      )
    : (terminalFailure ?? waiting);
  const updatedAt = new Date(run.updatedAt).getTime();
  const metrics = measureBrowserTask(
    events,
    Math.max(0, (settled ? updatedAt : now) - startedAt)
  );
  const message = events.findLast(
    (event) => event.type === "message.completed"
  );
  const status = forcedBackgroundFailure
    ? "failure"
    : (completion?.status ?? historyFallbackStatus(run, settled));

  return {
    activity:
      status === "running"
        ? (latestTaskUpdate(events) ??
          (hasBackgroundTask ? "Background worker running…" : undefined))
        : undefined,
    completedAt: settled ? (eventTime(terminalEvent) ?? updatedAt) : undefined,
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    id: run.sessionId,
    prompt:
      received?.type === "message.received" && received.data.message.trim()
        ? received.data.message
        : run.prompt,
    sessionId: run.sessionId,
    startedAt,
    status,
    terminalMessage:
      status === "running"
        ? undefined
        : terminalBrowserMessage(
            message?.type === "message.completed"
              ? (message.data.message ?? undefined)
              : undefined,
            events
          ),
  };
}

function backgroundChildState(
  input: readonly MessageStreamEvent[] | TaskSessionTree
) {
  if (!isTaskSessionTree(input)) return;
  const children = input.sessions.filter(
    ({ sessionId }) => sessionId !== input.rootSessionId
  );
  if (children.length === 0) return;

  const childStates = children.map(({ events }) => {
    const terminalEvent = events.at(-1);
    const settled =
      terminalEvent !== undefined && isCurrentTurnBoundaryEvent(terminalEvent);
    return {
      completion: readTaskCompletion(events),
      settled,
      terminalEvent: settled ? terminalEvent : undefined,
    };
  });
  const active = childStates.some(({ settled }) => !settled);
  const settled = childStates.every((state) => state.settled);
  return {
    active,
    settled,
    succeeded:
      settled &&
      childStates.every(({ completion }) => completion?.status === "success"),
    terminalEvent: settled
      ? childStates
          .flatMap(({ terminalEvent }) =>
            terminalEvent ? [terminalEvent] : []
          )
          .at(-1)
      : undefined,
  };
}

function isTaskSessionTree(
  input: readonly MessageStreamEvent[] | TaskSessionTree
): input is TaskSessionTree {
  return !Array.isArray(input);
}

export function latestTaskUpdate(events: readonly MessageStreamEvent[]) {
  for (const event of events.toReversed()) {
    if (event.type !== "actions.requested") continue;
    for (const action of event.data.actions.toReversed()) {
      if (
        action.kind === "tool-call" &&
        action.toolName === "task_update" &&
        typeof action.input.message === "string" &&
        action.input.message.trim()
      ) {
        return action.input.message.trim();
      }
    }
  }
}

function historyFallbackStatus(
  run: TaskHistoryRun,
  settled: boolean
): BrowserRunTask["status"] {
  if (run.status === "failed" || run.status === "cancelled" || settled) {
    return "failure";
  }
  return "running";
}

function eventTime(event: MessageStreamEvent | undefined) {
  return event === undefined ? undefined : new Date(event.meta.at).getTime();
}

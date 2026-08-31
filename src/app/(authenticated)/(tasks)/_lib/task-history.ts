import type { MessageStreamEvent } from "eve/client";
import type { RouterOutputs } from "@/trpc/types";
import type {
  BrowserRunGroup,
  BrowserRunTask,
} from "@/app/(authenticated)/_lib/browser-run-store";
import {
  measureWorkerTask,
  readBackgroundWorkerTasks,
  readTaskCompletion,
  terminalWorkerMessage,
} from "@/lib/worker-events";

export type TaskHistoryPage = RouterOutputs["tasks"]["list"];
export type TaskHistoryRun = TaskHistoryPage["runs"][number];

export function taskFromHistoryRun(
  run: TaskHistoryRun,
  events: readonly MessageStreamEvent[],
  now = Date.now()
): BrowserRunTask {
  const received = events.find((event) => event.type === "message.received");
  const startedAt = received
    ? new Date(received.meta.at).getTime()
    : new Date(run.createdAt).getTime();
  const completion = readTaskCompletion(events);
  const sessionFailure = events.findLast(
    (event) => event.type === "session.failed"
  );
  const turnTerminal = events.findLast(
    (event) => event.type === "turn.failed" || event.type === "turn.cancelled"
  );
  const waiting = events.findLast(
    (event) =>
      event.type === "session.waiting" || event.type === "session.completed"
  );
  const workerTasks = readBackgroundWorkerTasks(events);
  const pendingWorker = workerTasks.some((task) => task.status === undefined);
  const terminalWorkerAt = workerTasks.findLast(
    (task) => task.terminalAt !== undefined
  )?.terminalAt;
  const terminalEvent = sessionFailure ?? turnTerminal ?? waiting;
  const settled =
    completion !== undefined ||
    sessionFailure !== undefined ||
    (!pendingWorker &&
      (turnTerminal !== undefined ||
        workerTasks.some((task) => task.status !== undefined) ||
        waiting?.type === "session.completed" ||
        waiting?.type === "session.waiting"));
  const updatedAt = new Date(run.updatedAt).getTime();
  const metrics = measureWorkerTask(
    events,
    Math.max(0, (settled ? updatedAt : now) - startedAt)
  );
  const message = events.findLast(
    (event) => event.type === "message.completed"
  );
  const status =
    completion?.status ??
    (events.length === 0
      ? historyFallbackStatus(run, settled)
      : run.status === "failed" || run.status === "cancelled" || settled
        ? "failure"
        : "running");
  const completedAtTimestamp =
    completion?.completedAt ?? terminalWorkerAt ?? terminalEvent?.meta.at;
  const completedAt = settled
    ? completedAtTimestamp
      ? new Date(completedAtTimestamp).getTime()
      : updatedAt
    : undefined;

  return {
    completedAt,
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
        : terminalWorkerMessage(
            message?.type === "message.completed"
              ? (message.data.message ?? undefined)
              : undefined,
            events
          ),
  };
}

function historyFallbackStatus(
  run: TaskHistoryRun,
  settled: boolean
): BrowserRunTask["status"] {
  switch (run.status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "failure";
    case "pending":
      return "queued";
    case "running":
      return settled ? "failure" : "running";
  }
}

export function historyTableGroups(
  runs: readonly TaskHistoryRun[],
  historyTasks: ReadonlyMap<string, BrowserRunTask>,
  localGroups: readonly BrowserRunGroup[]
) {
  const localBySession = new Map(
    localGroups.flatMap((group) =>
      group.tasks.flatMap((task) =>
        task.sessionId ? [[task.sessionId, { group, task }] as const] : []
      )
    )
  );
  const rows = runs.map((run) => {
    const local = localBySession.get(run.sessionId);
    const task =
      historyTasks.get(run.sessionId) ?? local?.task ?? indexedTask(run);
    return { group: local?.group, task };
  });
  const indexedSessions = new Set(runs.map((run) => run.sessionId));

  for (const group of localGroups) {
    for (const task of group.tasks) {
      if (task.sessionId && indexedSessions.has(task.sessionId)) continue;
      rows.push({ group, task });
    }
  }

  return rows
    .toSorted(
      (left, right) =>
        taskSortTime(right.task, right.group) -
        taskSortTime(left.task, left.group)
    )
    .map(({ group, task }) => ({
      group: {
        id: group?.id ?? "",
        name: group?.name ?? "Single task",
      },
      task,
    }));
}

function indexedTask(run: TaskHistoryRun): BrowserRunTask {
  const startedAt = new Date(run.createdAt).getTime();
  return {
    costComplete: false,
    costUsd: null,
    durationMs: Math.max(0, new Date(run.updatedAt).getTime() - startedAt),
    id: run.sessionId,
    prompt: run.prompt,
    sessionId: run.sessionId,
    startedAt,
    status: historyFallbackStatus(run, false),
  };
}

function taskSortTime(
  task: BrowserRunTask,
  group: BrowserRunGroup | undefined
) {
  return task.startedAt ?? new Date(group?.createdAt ?? 0).getTime();
}

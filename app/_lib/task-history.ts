import { z } from "zod";
import type { MessageStreamEvent } from "eve/client";
import {
  measureBrowserTask,
  readBackgroundWorkerTasks,
  readTaskCompletion,
  terminalBrowserMessage,
} from "@/lib/browser/benchmark";
import type { BrowserRunTask } from "./browser-run-store";

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

export type TaskHistoryRun = z.infer<
  typeof taskHistoryPageSchema
>["runs"][number];

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
  const metrics = measureBrowserTask(
    events,
    Math.max(0, (settled ? updatedAt : now) - startedAt)
  );
  const message = events.findLast(
    (event) => event.type === "message.completed"
  );
  const status =
    completion?.status ??
    (run.status === "failed" || run.status === "cancelled" || settled
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
        : terminalBrowserMessage(
            message?.type === "message.completed"
              ? (message.data.message ?? undefined)
              : undefined,
            events
          ),
  };
}

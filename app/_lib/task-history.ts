import { z } from "zod";
import type { MessageStreamEvent } from "eve/client";
import {
  measureBrowserTask,
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

type TaskHistoryPage = z.infer<typeof taskHistoryPageSchema>;
export type TaskHistoryRun = TaskHistoryPage["runs"][number];

export function taskFromHistoryRun(
  run: TaskHistoryRun,
  events: readonly MessageStreamEvent[],
  now = Date.now()
): BrowserRunTask {
  const received = events.find((event) => event.type === "message.received");
  const startedAt = eventTime(received) ?? new Date(run.createdAt).getTime();
  const completion = readTaskCompletion(events);
  const terminalFailure = events.findLast(
    (event) =>
      event.type === "turn.failed" ||
      event.type === "turn.cancelled" ||
      event.type === "session.failed"
  );
  const waiting = events.findLast(
    (event) =>
      event.type === "session.waiting" || event.type === "session.completed"
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
  const status = completion?.status ?? historyFallbackStatus(run, settled);

  return {
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

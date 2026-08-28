import { z } from "zod";
import type { MessageStreamEvent } from "eve/client";
import { parseTaskCompletionOutput } from "../task-completion";

const workerTaskNotificationPrefix = /^Background task (\S+) \(worker\) /u;
const terminalTaskControlSchema = z.object({
  tasks: z.array(
    z.object({
      status: z.enum(["cancelled", "completed", "failed"]),
      taskId: z.string(),
    })
  ),
});

interface BackgroundWorkerTaskState {
  output?: string;
  status?: "cancelled" | "completed" | "failed";
  taskId: string;
  terminalAt?: string;
}

export function measureBrowserTask(
  events: readonly MessageStreamEvent[],
  fallbackDurationMs: number
) {
  const start = events.find((event) => event.type === "message.received")?.meta
    .at;
  const backgroundTasks = readBackgroundWorkerTasks(events);
  const pendingWorker = backgroundTasks.some(
    (task) => task.status === undefined
  );
  const terminal =
    readTaskCompletion(events)?.completedAt ??
    (pendingWorker
      ? undefined
      : backgroundTasks.findLast((task) => task.terminalAt)?.terminalAt) ??
    events.findLast(
      (event) =>
        event.type === "session.failed" ||
        (!pendingWorker &&
          (event.type === "turn.failed" || event.type === "turn.cancelled"))
    )?.meta.at;
  let completedSteps = 0;
  let measuredSteps = 0;
  let costUsd = 0;

  for (const event of events) {
    if (event.type !== "step.completed") continue;
    completedSteps += 1;

    const cost = event.data.usage?.costUsd;
    if (cost === undefined) continue;
    measuredSteps += 1;
    costUsd += cost;
  }

  return {
    costComplete: completedSteps > 0 && measuredSteps === completedSteps,
    costUsd: measuredSteps === 0 ? null : costUsd,
    durationMs:
      start && terminal
        ? elapsedMs(start, terminal)
        : Math.max(0, fallbackDurationMs),
  };
}

export function didCompleteBrowserWorker(
  events: readonly MessageStreamEvent[]
) {
  return readTaskCompletion(events)?.status === "success";
}

export function didFinishBrowserWorker(events: readonly MessageStreamEvent[]) {
  const backgroundTasks = readBackgroundWorkerTasks(events);
  if (backgroundTasks.length > 0) {
    return backgroundTasks.every((task) => task.status !== undefined);
  }
  return readTaskCompletion(events) !== undefined;
}
export function terminalBrowserMessage(
  message: string | undefined,
  events: readonly MessageStreamEvent[]
) {
  const completion = readTaskCompletion(events);
  if (completion) return normalizeMessage(completion.message);

  if (message?.trim()) return normalizeMessage(message);

  const failure = events.findLast(
    (event) => event.type === "turn.failed" || event.type === "session.failed"
  );

  return failure
    ? normalizeMessage(failure.data.message)
    : "No terminal message";
}

export function readTaskCompletion(events: readonly MessageStreamEvent[]) {
  const backgroundTasks = readBackgroundWorkerTasks(events);
  if (backgroundTasks.length > 0) {
    if (backgroundTasks.some((task) => task.status === undefined)) {
      return undefined;
    }

    const latest = backgroundTasks.at(-1);
    if (latest?.status === "completed" && latest.output && latest.terminalAt) {
      const completion = parseTaskCompletionOutput(latest.output);
      if (completion) return { ...completion, completedAt: latest.terminalAt };
    }
    return undefined;
  }

  for (const event of events.toReversed()) {
    if (event.type === "result.completed") {
      const completion = parseTaskCompletionOutput(event.data.result);
      if (completion) return { ...completion, completedAt: event.meta.at };
      continue;
    }

    if (event.type === "subagent.completed") {
      if (
        event.data.subagentName === "worker" &&
        event.data.backgroundTask === undefined
      ) {
        const completion = parseTaskCompletionOutput(event.data.output);
        if (completion) return { ...completion, completedAt: event.meta.at };
      }
      continue;
    }

    if (event.type !== "action.result" || event.data.status !== "completed") {
      continue;
    }

    const result = event.data.result;
    if (result.kind === "subagent-result") {
      if (
        result.subagentName === "worker" &&
        (result.origin !== "child" || result.backgroundTask === undefined)
      ) {
        const completion = parseTaskCompletionOutput(result.output);
        if (completion) return { ...completion, completedAt: event.meta.at };
      }
      continue;
    }
  }

  return undefined;
}

function readWorkerTaskNotification(event: MessageStreamEvent) {
  if (event.type !== "message.received") return undefined;
  const match = workerTaskNotificationPrefix.exec(event.data.message);
  if (!match) return undefined;
  const [, taskId] = match;
  if (!taskId) return undefined;
  const message = event.data.message.slice(match[0].length);

  if (message === "is cancelled.")
    return { status: "cancelled" as const, taskId };

  const completedPrefix = "is completed.\n\nResult:\n";
  if (message.startsWith(completedPrefix)) {
    return {
      output: message.slice(completedPrefix.length),
      status: "completed" as const,
      taskId,
    };
  }

  const failedPrefix = "failed.\n\nError:\n";
  if (message.startsWith(failedPrefix)) {
    return {
      output: message.slice(failedPrefix.length),
      status: "failed" as const,
      taskId,
    };
  }

  return undefined;
}

function readBackgroundWorkerTasks(events: readonly MessageStreamEvent[]) {
  const tasks = new Map<string, BackgroundWorkerTaskState>();

  for (const event of events) {
    const receiptTaskId = readBackgroundWorkerReceiptTaskId(event);
    if (receiptTaskId) {
      tasks.set(receiptTaskId, {
        taskId: receiptTaskId,
      });
      continue;
    }

    const notification = readWorkerTaskNotification(event);
    if (notification) {
      const task = tasks.get(notification.taskId);
      if (task) {
        tasks.set(notification.taskId, {
          ...task,
          output: notification.output,
          status: notification.status,
          terminalAt: event.meta.at,
        });
      }
      continue;
    }

    if (
      event.type !== "action.result" ||
      event.data.status !== "completed" ||
      event.data.result.kind !== "tool-result" ||
      event.data.result.toolName !== "task_cancel"
    ) {
      continue;
    }

    const parsed = terminalTaskControlSchema.safeParse(
      event.data.result.output
    );
    if (!parsed.success) continue;
    for (const result of parsed.data.tasks) {
      const task = tasks.get(result.taskId);
      if (!task) continue;
      tasks.set(result.taskId, {
        ...task,
        status: result.status,
        terminalAt: event.meta.at,
      });
    }
  }

  return [...tasks.values()];
}

function readBackgroundWorkerReceiptTaskId(event: MessageStreamEvent) {
  if (
    event.type === "subagent.completed" &&
    event.data.subagentName === "worker" &&
    event.data.backgroundTask !== undefined
  ) {
    return event.data.backgroundTask.taskId;
  }

  if (
    event.type === "action.result" &&
    event.data.result.kind === "subagent-result" &&
    event.data.result.subagentName === "worker" &&
    event.data.result.origin === "child" &&
    event.data.result.backgroundTask !== undefined
  ) {
    return event.data.result.backgroundTask.taskId;
  }

  return undefined;
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function normalizeMessage(message: string) {
  return message.replaceAll(/\s+/gu, " ").trim();
}

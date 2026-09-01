import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { z } from "zod";

const backgroundWorkerDelivery =
  /^Background task (\S+) \(worker\) (?:update: |needs input\.$|is cancelled\.$|is completed\.\n\nResult:\n|failed\.\n\nError:\n)/u;
const backgroundWorkerAuthorization =
  /^Background task (\S+) needs authorization\.$/u;
const taskCancelResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: z.object({ tasks: z.array(z.unknown()) }),
  toolName: z.literal("task_cancel"),
});
const cancelledWorkerTaskSchema = z.object({
  metadata: z.object({ name: z.literal("worker") }),
  status: z.literal("cancelled"),
  taskId: z.string(),
});

export type TraceView = "imessage" | "trace";

export function messagesForTraceView(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  traceView: TraceView
) {
  if (traceView === "trace") return messages;
  const hiddenMessageIds = backgroundWorkerDeliveryMessageIds(events);
  return messages.filter((message) => !hiddenMessageIds.has(message.id));
}

export function backgroundWorkerDeliveryMessageIds(
  events: readonly MessageStreamEvent[]
) {
  // Eve task deliveries currently share message.received with user input, so
  // require both its exact framework grammar and a receipt from this worker.
  const taskIds = workerTaskIds(events);
  const cancelledTaskIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const event of events) {
    if (event.type === "action.result") {
      const result = taskCancelResultSchema.safeParse(event.data.result);
      if (!result.success) continue;
      for (const value of result.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) cancelledTaskIds.add(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received") continue;
    const taskId = deliveredTaskId(event.data.message);
    if (taskId && taskIds.has(taskId)) {
      const isCancellation = event.data.message.endsWith(
        "(worker) is cancelled."
      );
      if (!isCancellation) messageIds.add(`${event.data.turnId}:user`);
      if (isCancellation && cancelledTaskIds.delete(taskId)) {
        messageIds.add(`${event.data.turnId}:user`);
        messageIds.add(`${event.data.turnId}:assistant`);
      }
    }
  }

  return messageIds;
}

export function hasPendingBackgroundWorker(
  events: readonly MessageStreamEvent[]
) {
  const taskIds = new Set<string>();

  for (const event of events) {
    if (
      event.type === "subagent.completed" &&
      event.data.subagentName === "worker" &&
      event.data.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.backgroundTask.taskId);
      continue;
    }

    if (event.type === "action.result") {
      const result = event.data.result;
      if (
        result.kind === "subagent-result" &&
        result.subagentName === "worker" &&
        result.origin === "child" &&
        result.backgroundTask !== undefined
      ) {
        taskIds.add(result.backgroundTask.taskId);
        continue;
      }

      const cancellation = taskCancelResultSchema.safeParse(result);
      if (!cancellation.success) continue;
      for (const value of cancellation.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) taskIds.delete(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received") continue;
    const taskId = deliveredTaskId(event.data.message);
    if (
      taskId &&
      !event.data.message.startsWith(
        `Background task ${taskId} (worker) update: `
      )
    ) {
      taskIds.delete(taskId);
    }
  }

  return taskIds.size > 0;
}

function workerTaskIds(events: readonly MessageStreamEvent[]) {
  const taskIds = new Set<string>();

  for (const event of events) {
    if (
      event.type === "subagent.completed" &&
      event.data.subagentName === "worker" &&
      event.data.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.backgroundTask.taskId);
      continue;
    }

    if (
      event.type === "action.result" &&
      event.data.result.kind === "subagent-result" &&
      event.data.result.subagentName === "worker" &&
      event.data.result.origin === "child" &&
      event.data.result.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.result.backgroundTask.taskId);
    }
  }

  return taskIds;
}

function deliveredTaskId(message: string) {
  return (
    backgroundWorkerDelivery.exec(message)?.[1] ??
    backgroundWorkerAuthorization.exec(message)?.[1]
  );
}

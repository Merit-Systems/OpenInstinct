import type { MessageStreamEvent } from "eve/client";
import { taskCompletionSchema } from "./task-completion";

export function measureBrowserTask(
  events: readonly MessageStreamEvent[],
  fallbackDurationMs: number
) {
  const start = events.find((event) => event.type === "message.received")?.meta
    .at;
  const terminal =
    readTaskCompletion(events)?.completedAt ??
    events.findLast(isTerminalFailureEvent)?.meta.at;
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

export function didCompleteKernelBrowserAction(
  events: readonly MessageStreamEvent[]
) {
  return events.some(
    (event) =>
      event.type === "action.result" &&
      event.data.status === "completed" &&
      event.data.result.kind === "tool-result" &&
      (event.data.result.toolName.endsWith("__execute_playwright_code") ||
        event.data.result.toolName.endsWith("__computer_action") ||
        event.data.result.toolName.endsWith("__browser_curl"))
  );
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
  // Preserve explicit outcomes from sessions created before complete_task was removed.
  for (const event of events.toReversed()) {
    if (
      event.type !== "action.result" ||
      event.data.status !== "completed" ||
      event.data.result.kind !== "tool-result" ||
      event.data.result.toolName !== "complete_task"
    ) {
      continue;
    }

    const completion = taskCompletionSchema.safeParse(event.data.result.output);
    if (completion.success) {
      return { ...completion.data, completedAt: event.meta.at };
    }
  }

  const terminal = events.findLast(
    (event) =>
      event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.cancelled" ||
      event.type === "session.failed"
  );
  if (!terminal) return undefined;

  if (terminal.type === "turn.completed") {
    const message = events.findLast(
      (event) =>
        event.type === "message.completed" &&
        event.data.turnId === terminal.data.turnId &&
        event.data.message?.trim()
    );
    return {
      completedAt: terminal.meta.at,
      message:
        message?.type === "message.completed" && message.data.message
          ? message.data.message
          : "Task completed.",
      status: "success" as const,
    };
  }

  return {
    completedAt: terminal.meta.at,
    message:
      terminal.type === "turn.cancelled"
        ? "Task cancelled."
        : terminal.data.message,
    status: "failure" as const,
  };
}

function isTerminalFailureEvent(event: MessageStreamEvent) {
  return (
    event.type === "turn.failed" ||
    event.type === "turn.cancelled" ||
    event.type === "session.failed"
  );
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function normalizeMessage(message: string) {
  return message.replaceAll(/\s+/gu, " ").trim();
}

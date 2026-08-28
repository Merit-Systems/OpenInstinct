import { parseWorkerTaskNotification } from "@/lib/eve-task-notifications";

const runtime = globalThis as typeof globalThis & {
  openInstinctWorkerCancellationTurns?: Map<string, string>;
};
const cancellationTurns = (runtime.openInstinctWorkerCancellationTurns ??=
  new Map<string, string>());

export function recordWorkerCancellationTurn(
  sessionId: string,
  turnId: string,
  message: string
) {
  const notification = parseWorkerTaskNotification(message);
  if (notification?.kind === "cancelled") {
    cancellationTurns.set(turnKey(sessionId, turnId), notification.taskId);
  }
}

export function consumeWorkerCancellationTurn(
  sessionId: string,
  turnId: string
) {
  const key = turnKey(sessionId, turnId);
  const taskId = cancellationTurns.get(key);
  cancellationTurns.delete(key);
  return taskId;
}

export function clearWorkerCancellationTurn(sessionId: string, turnId: string) {
  cancellationTurns.delete(turnKey(sessionId, turnId));
}

function turnKey(sessionId: string, turnId: string) {
  return `${sessionId}:${turnId}`;
}

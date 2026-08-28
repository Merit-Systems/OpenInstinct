// Eve announces background-task lifecycle only as prose messages; delete this once it emits typed events.
type TaskNotification =
  | { readonly kind: "authorization"; readonly taskId: string }
  | TaskAgentNotification;

interface TaskAgentNotification {
  readonly agentName: string;
  readonly kind:
    | "cancelled"
    | "completed"
    | "failed"
    | "needs-input"
    | "update";
  readonly output?: string;
  readonly taskId: string;
}

const notificationPrefix = /^Background task (\S+) \(([\w-]+)\) /u;
const authorizationNotification =
  /^Background task (\S+) needs authorization\.$/u;
const completedPrefix = "is completed.\n\nResult:\n";
const failedPrefix = "failed.\n\nError:\n";

function parseTaskNotification(message: string): TaskNotification | undefined {
  const authorized = authorizationNotification.exec(message)?.[1];
  if (authorized) return { kind: "authorization", taskId: authorized };

  const match = notificationPrefix.exec(message);
  const taskId = match?.[1];
  const agentName = match?.[2];
  if (!match || !taskId || !agentName) return undefined;
  const rest = message.slice(match[0].length);

  if (rest === "is cancelled.") return { agentName, kind: "cancelled", taskId };
  if (rest === "needs input.")
    return { agentName, kind: "needs-input", taskId };
  if (rest.startsWith("update: ")) return { agentName, kind: "update", taskId };
  if (rest.startsWith(completedPrefix)) {
    return {
      agentName,
      kind: "completed",
      output: rest.slice(completedPrefix.length),
      taskId,
    };
  }
  if (rest.startsWith(failedPrefix)) {
    return {
      agentName,
      kind: "failed",
      output: rest.slice(failedPrefix.length),
      taskId,
    };
  }
  return undefined;
}

export function parseWorkerTaskNotification(message: string) {
  const notification = parseTaskNotification(message);
  if (!notification) return undefined;
  if (
    notification.kind !== "authorization" &&
    notification.agentName !== "worker"
  ) {
    return undefined;
  }
  return notification;
}

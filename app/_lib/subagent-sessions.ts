import type {
  MessageStreamEvent,
  SubagentCalledStreamEvent,
  SubagentCompletedStreamEvent,
} from "eve/client";

export type SubagentSession = SubagentCalledStreamEvent["data"] & {
  readonly completion?: SubagentCompletedStreamEvent["data"];
};

export type SubagentStatus =
  | "cancelled"
  | "complete"
  | "failed"
  | "ready"
  | "starting"
  | "working";

export function collectSubagentSessions(
  events: readonly MessageStreamEvent[]
): readonly SubagentSession[] {
  const completions = new Map<string, SubagentCompletedStreamEvent["data"]>();
  const sessions = new Map<string, SubagentSession>();

  for (const event of events) {
    if (event.type === "subagent.completed") {
      completions.set(event.data.callId, event.data);
    }
  }

  for (const event of events) {
    if (event.type !== "subagent.called") continue;

    const session = {
      ...event.data,
      completion: completions.get(event.data.callId),
    };
    sessions.delete(session.childSessionId);
    sessions.set(session.childSessionId, session);
  }

  return [...sessions.values()].toReversed();
}

export function getSubagentSubscriptionKey(
  sessions: readonly SubagentSession[]
) {
  return sessions
    .map(
      (session) =>
        `${encodeURIComponent(session.childSessionId)}:${encodeURIComponent(session.callId)}`
    )
    .join("\n");
}

export function getSubagentStatus(
  events: readonly MessageStreamEvent[],
  session: SubagentSession
): SubagentStatus {
  const terminalSession = events
    .toReversed()
    .find((event) =>
      ["session.completed", "session.failed"].includes(event.type)
    );
  if (terminalSession?.type === "session.completed") return "complete";
  if (terminalSession?.type === "session.failed") return "failed";

  const latestTurnBoundary = events
    .toReversed()
    .find((event) =>
      [
        "turn.cancelled",
        "turn.completed",
        "turn.failed",
        "turn.started",
      ].includes(event.type)
    );
  if (latestTurnBoundary?.type === "turn.failed") return "failed";
  if (latestTurnBoundary?.type === "turn.cancelled") return "cancelled";
  if (latestTurnBoundary?.type === "turn.completed") return "ready";
  if (latestTurnBoundary?.type === "turn.started") return "working";
  if (events.some((event) => event.type === "session.waiting")) return "ready";
  if (session.completion && !session.completion.backgroundTask) return "ready";
  return "starting";
}

export function getSubagentTask(events: readonly MessageStreamEvent[]) {
  const message = events.find((event) => event.type === "message.received")
    ?.data.message;
  return message
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^Task:\s*/iu, "");
}

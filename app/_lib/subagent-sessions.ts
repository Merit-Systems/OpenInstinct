import type {
  MessageStreamEvent,
  SubagentCalledStreamEvent,
  SubagentCompletedStreamEvent,
} from "eve/client";

export type SubagentSession = SubagentCalledStreamEvent["data"] & {
  readonly completion?: SubagentCompletedStreamEvent["data"];
};

export interface SubagentSessionNode {
  readonly depth: number;
  readonly session: SubagentSession;
}

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

export function collectSubagentSessionTree(
  rootSessions: readonly SubagentSession[],
  eventsBySession: ReadonlyMap<string, readonly MessageStreamEvent[]>
): readonly SubagentSessionNode[] {
  const nodes: SubagentSessionNode[] = [];
  const visited = new Set<string>();

  function visit(sessions: readonly SubagentSession[], depth: number) {
    for (const session of sessions) {
      if (visited.has(session.childSessionId)) continue;
      visited.add(session.childSessionId);
      nodes.push({ depth, session });
      visit(
        collectSubagentSessions(
          eventsBySession.get(session.childSessionId) ?? []
        ),
        depth + 1
      );
    }
  }

  visit(rootSessions, 0);
  return nodes;
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
  return events.findLast((event) => event.type === "message.received")?.data
    .message;
}

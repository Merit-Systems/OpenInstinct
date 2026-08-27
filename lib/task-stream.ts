import {
  isCurrentTurnBoundaryEvent,
  type MessageStreamEvent,
} from "eve/client";

interface TaskStreamClient {
  readonly sessions: {
    attach(
      sessionId: string,
      state: { readonly streamIndex: number }
    ): {
      cancel(): Promise<unknown>;
      stream(options: {
        readonly follow?: boolean;
        readonly startIndex: number;
      }): AsyncIterable<MessageStreamEvent>;
    };
  };
}

interface TaskSessionSnapshot {
  readonly events: readonly MessageStreamEvent[];
  readonly sessionId: string;
}

export interface TaskSessionTree {
  readonly events: readonly MessageStreamEvent[];
  readonly rootSessionId: string;
  readonly sessions: readonly TaskSessionSnapshot[];
}

export function subagentSessionIds(
  events: readonly MessageStreamEvent[]
): string[] {
  return [
    ...new Set(
      events.flatMap((event) =>
        event.type === "subagent.called" ? [event.data.childSessionId] : []
      )
    ),
  ];
}

export async function readTaskSessionTree(
  client: TaskStreamClient,
  rootSessionId: string
): Promise<TaskSessionTree> {
  const events: MessageStreamEvent[] = [];
  const pending = [rootSessionId];
  const sessions: TaskSessionSnapshot[] = [];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const sessionId = pending.shift();
    if (!sessionId || visited.has(sessionId)) continue;
    visited.add(sessionId);

    const sessionEvents: MessageStreamEvent[] = [];
    const session = client.sessions.attach(sessionId, { streamIndex: 0 });
    for await (const event of session.stream({
      follow: false,
      startIndex: 0,
    })) {
      sessionEvents.push(event);
    }
    sessions.push({ events: sessionEvents, sessionId });
    events.push(...sessionEvents);
    pending.push(
      ...subagentSessionIds(sessionEvents).filter(
        (childSessionId) => !visited.has(childSessionId)
      )
    );
  }

  return { events, rootSessionId, sessions };
}

export async function followDelegatedTaskSessions(
  client: TaskStreamClient,
  parentEvents: readonly MessageStreamEvent[],
  onEvent: (event: MessageStreamEvent) => void
): Promise<void> {
  const visited = new Set<string>();

  const followSession = async (sessionId: string): Promise<void> => {
    if (visited.has(sessionId)) return;
    visited.add(sessionId);

    const childEvents: MessageStreamEvent[] = [];
    const session = client.sessions.attach(sessionId, { streamIndex: 0 });
    for await (const event of session.stream({ startIndex: 0 })) {
      childEvents.push(event);
      onEvent(event);
      if (isCurrentTurnBoundaryEvent(event)) break;
    }
    await Promise.all(
      subagentSessionIds(childEvents).map((childSessionId) =>
        followSession(childSessionId)
      )
    );
  };

  await Promise.all(
    subagentSessionIds(parentEvents).map((sessionId) =>
      followSession(sessionId)
    )
  );
}

export async function cancelTaskSessions(
  client: TaskStreamClient,
  sessionIds: Iterable<string>
): Promise<void> {
  await Promise.allSettled(
    [...new Set(sessionIds)].map((sessionId) =>
      client.sessions.attach(sessionId, { streamIndex: 0 }).cancel()
    )
  );
}

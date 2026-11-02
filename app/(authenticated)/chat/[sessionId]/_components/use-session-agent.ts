"use client";

import {
  Client,
  conversationOf,
  endsTurn,
  type MessageContent,
  type RespondTurnOptions,
  type SendTurnOptions,
  type SessionStreamEvent,
} from "eve/client";
import { type Answer, idle } from "eve/events";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  appendHistoryEvent,
  readLatestSessionHistory,
  readOlderSessionHistory,
  type SessionHistoryPage,
} from "../_lib/session-history";
import type { ChatAgent, ChatAgentStatus } from "./chat-agent";

const client = new Client({ baseUrl: "" });

export function useSessionAgent(sessionId: string): ChatAgent {
  const [history, setHistory] = useState<SessionHistoryPage>();
  const [status, setStatus] = useState<ChatAgentStatus>("resuming");
  const [error, setError] = useState<Error>();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const historyRef = useRef(history);
  const operationRef = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const followActiveTurn = useCallback(
    async (startIndex: number, signal?: AbortSignal) => {
      const session = client.sessions.attach(sessionId, {
        streamIndex: startIndex,
      });
      let turnEnded = false;
      for await (const event of session.stream({ signal, startIndex })) {
        appendSessionEvent(historyRef, setHistory, event);
        setStatus("streaming");
        turnEnded ||= endsTurn(event);
        // Stop only after the whole stored line that ended the turn.
        if (turnEnded && event.meta.endOfLine !== false) break;
      }
    },
    [sessionId]
  );

  const catchUp = useCallback(
    async (signal?: AbortSignal) => {
      const current = historyRef.current;
      if (!current) return;

      const session = client.sessions.attach(sessionId, {
        streamIndex: current.endIndex,
      });
      for await (const event of session.stream({
        follow: false,
        signal,
        startIndex: current.endIndex,
      })) {
        appendSessionEvent(historyRef, setHistory, event);
      }

      const latest = historyRef.current;
      if (latest && isWorking(latest.events)) {
        await followActiveTurn(latest.endIndex, signal);
      }
    },
    [followActiveTurn, sessionId]
  );

  const runOperation = useCallback((operation: () => Promise<void>) => {
    const activeOperation = operationRef.current;
    if (activeOperation) return activeOperation;
    const promise = operation().finally(() => {
      if (operationRef.current === promise) operationRef.current = undefined;
    });
    operationRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void readLatestSessionHistory(
      client.sessions.attach(sessionId),
      controller.signal
    )
      .then(async (latest) => {
        if (controller.signal.aborted) return undefined;
        historyRef.current = latest;
        setHistory(latest);
        if (isWorking(latest.events)) {
          setStatus("streaming");
          await runOperation(async () => {
            await followActiveTurn(latest.endIndex, controller.signal);
          });
        }
        setStatus("ready");
        return undefined;
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return undefined;
        setError(toError(cause));
        setStatus("error");
        return undefined;
      });

    return () => {
      controller.abort();
    };
  }, [followActiveTurn, runOperation, sessionId]);

  const resume = useCallback(
    () =>
      runOperation(async () => {
        setStatus("resuming");
        setError(undefined);
        try {
          await catchUp();
          setStatus("ready");
        } catch (cause) {
          setError(toError(cause));
          setStatus("error");
        }
      }),
    [catchUp, runOperation]
  );

  const send = useCallback(
    async <TOutput>(
      message: MessageContent,
      options?: SendTurnOptions<TOutput>
    ) => {
      const activeOperation = operationRef.current;
      if (activeOperation && options?.turnPolicy === "steer") {
        // A steering message joins the running turn: the active read picks up
        // its events, and a catch-up read collects anything after that read.
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        await session.send(message, options);
        await activeOperation;
        await resume();
        return;
      }

      await runOperation(async () => {
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        setError(undefined);
        setStatus("submitted");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        try {
          const delivery = await session.send(message, options);
          for await (const event of delivery.stream()) {
            appendSessionEvent(historyRef, setHistory, event);
            setStatus("streaming");
          }
          setStatus("ready");
        } catch (cause) {
          setError(toError(cause));
          setStatus("error");
          throw cause;
        }
      });
    },
    [resume, runOperation, sessionId]
  );

  const respond = useCallback(
    async <TOutput>(
      answers: readonly Answer[],
      options?: RespondTurnOptions<TOutput>
    ) => {
      await runOperation(async () => {
        const current = historyRef.current;
        if (!current) throw new Error("The conversation is still loading.");
        setError(undefined);
        setStatus("submitted");
        const session = client.sessions.attach(sessionId, {
          streamIndex: current.endIndex,
        });
        try {
          const delivery = await session.respond(answers, options);
          for await (const event of delivery.stream()) {
            appendSessionEvent(historyRef, setHistory, event);
            setStatus("streaming");
          }
          setStatus("ready");
        } catch (cause) {
          setError(toError(cause));
          setStatus("error");
          throw cause;
        }
      });
    },
    [runOperation, sessionId]
  );

  const loadOlder = async () => {
    const current = historyRef.current;
    if (!current || current.startIndex === 0 || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const older = await readOlderSessionHistory(
        client.sessions.attach(sessionId),
        current.startIndex
      );
      setHistory((latest) =>
        latest
          ? {
              ...latest,
              events: [...older.events, ...latest.events],
              startIndex: older.startIndex,
            }
          : latest
      );
    } catch (cause) {
      setError(toError(cause));
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const events = history?.events ?? emptyEvents;
  const conversation = useMemo(() => conversationOf(events), [events]);

  return {
    cancel: async () => await client.sessions.attach(sessionId).cancel(),
    error,
    events,
    hasOlder: (history?.startIndex ?? 0) > 0,
    isLoadingOlder,
    loadOlder,
    messages: conversation.messages,
    respond,
    resume,
    send,
    status,
    view: conversation.view,
  };
}

const emptyEvents: readonly SessionStreamEvent[] = [];

/** True while the session has a running turn or task that will record more events. */
function isWorking(events: readonly SessionStreamEvent[]) {
  return events.length > 0 && !idle(conversationOf(events).view);
}

function appendSessionEvent(
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  event: SessionStreamEvent
) {
  setHistory((current) => {
    if (!current) return current;
    const next = appendHistoryEvent(current, event);
    historyRef.current = next;
    return next;
  });
}

function toError(cause: unknown) {
  return cause instanceof Error
    ? cause
    : new Error("The session request failed.");
}

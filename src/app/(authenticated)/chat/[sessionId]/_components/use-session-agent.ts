"use client";

import {
  Client,
  defaultMessageReducer,
  isCurrentTurnBoundaryEvent,
  type InputResponse,
  type MessageStreamEvent,
  type RespondTurnOptions,
  type SendTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import type { UserContent } from "ai";
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
  readLatestSessionHistory,
  readOlderSessionHistory,
  type SessionHistoryPage,
} from "../_lib/session-history";
import type { ChatAgent } from "./chat-agent";

const client = new Client({ host: "" });
const messageReducer = defaultMessageReducer();

export function useSessionAgent(sessionId: string): ChatAgent {
  const [history, setHistory] = useState<SessionHistoryPage>();
  const [status, setStatus] = useState<UseEveAgentStatus>("resuming");
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
      let nextIndex = startIndex;
      for await (const event of session.stream({ signal, startIndex })) {
        nextIndex += 1;
        appendSessionEvent(historyRef, setHistory, event, nextIndex);
        setStatus("streaming");
        if (isCurrentTurnBoundaryEvent(event)) break;
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
      let nextIndex = current.endIndex;
      let latest = current.events.at(-1);
      for await (const event of session.stream({
        follow: false,
        signal,
        startIndex: nextIndex,
      })) {
        nextIndex += 1;
        latest = event;
        appendSessionEvent(historyRef, setHistory, event, nextIndex);
      }

      if (latest && !isCurrentTurnBoundaryEvent(latest)) {
        await followActiveTurn(nextIndex, signal);
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

    void readLatestSessionHistory(sessionId, controller.signal)
      .then(async (latest) => {
        if (controller.signal.aborted) return undefined;
        historyRef.current = latest;
        setHistory(latest);
        const tail = latest.events.at(-1);
        if (tail && !isCurrentTurnBoundaryEvent(tail)) {
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
      message: string | UserContent,
      options?: SendTurnOptions<TOutput>
    ) => {
      const activeOperation = operationRef.current;
      if (activeOperation && options?.turnPolicy === "steer") {
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
        let nextIndex = current.endIndex;
        try {
          const response = await session.send(message, options);
          for await (const event of response) {
            nextIndex += 1;
            appendSessionEvent(historyRef, setHistory, event, nextIndex);
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
      inputResponses: readonly InputResponse[],
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
        let nextIndex = current.endIndex;
        try {
          const response = await session.respond(inputResponses, options);
          for await (const event of response) {
            nextIndex += 1;
            appendSessionEvent(historyRef, setHistory, event, nextIndex);
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
        sessionId,
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
  const data = useMemo<EveMessageData>(
    () =>
      events.reduce(
        (current, event) => messageReducer.reduce(current, event),
        messageReducer.initial()
      ),
    [events]
  );

  return {
    cancel: async () => await client.sessions.attach(sessionId).cancel(),
    data,
    error,
    events,
    hasOlder: (history?.startIndex ?? 0) > 0,
    isLoadingOlder,
    loadOlder,
    respond,
    resume,
    send,
    status,
  };
}

const emptyEvents: readonly MessageStreamEvent[] = [];

function appendSessionEvent(
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  event: MessageStreamEvent,
  endIndex: number
) {
  setHistory((current) => {
    if (!current) return current;
    let next: SessionHistoryPage;
    if (
      current.events.some((candidate) => candidate.meta.id === event.meta.id)
    ) {
      next = { ...current, endIndex };
    } else {
      next = {
        ...current,
        endIndex,
        events: [...current.events, event],
      };
    }
    historyRef.current = next;
    return next;
  });
}

function toError(cause: unknown) {
  return cause instanceof Error
    ? cause
    : new Error("The session request failed.");
}

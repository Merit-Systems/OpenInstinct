"use client";

import {
  Client,
  isCurrentTurnBoundaryEvent,
  type MessageStreamEvent,
} from "eve/client";
import { useEffect, useRef, useState } from "react";
import {
  readLatestSessionHistory,
  readOlderSessionHistory,
  type SessionHistoryPage,
} from "../../_lib/session-history";

const client = new Client({ host: "" });

export function useSessionHistory(sessionId: string) {
  const [history, setHistory] = useState<SessionHistoryPage>();
  const [error, setError] = useState<string>();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const historyRef = useRef(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const controller = new AbortController();

    void readLatestSessionHistory(sessionId, controller.signal)
      .then(async (latest) => {
        if (controller.signal.aborted) return undefined;
        historyRef.current = latest;
        setHistory(latest);

        const tail = latest.events.at(-1);
        if (!tail || isCurrentTurnBoundaryEvent(tail)) return undefined;

        const session = client.sessions.attach(sessionId, {
          streamIndex: latest.endIndex,
        });
        let nextIndex = latest.endIndex;
        for await (const event of session.stream({
          signal: controller.signal,
          startIndex: nextIndex,
        })) {
          nextIndex += 1;
          appendEvent(setHistory, event, nextIndex);
          if (isCurrentTurnBoundaryEvent(event)) break;
        }
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The task stream disconnected."
          );
        }
        return undefined;
      });

    return () => {
      controller.abort();
    };
  }, [sessionId]);

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
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load older task messages."
      );
    } finally {
      setIsLoadingOlder(false);
    }
  };

  return {
    error,
    events: history?.events ?? [],
    hasOlder: (history?.startIndex ?? 0) > 0,
    isLoading: history === undefined && error === undefined,
    isLoadingOlder,
    loadOlder,
  };
}

function appendEvent(
  setHistory: React.Dispatch<
    React.SetStateAction<SessionHistoryPage | undefined>
  >,
  event: MessageStreamEvent,
  endIndex: number
) {
  setHistory((current) => {
    if (!current) return current;
    if (
      current.events.some((candidate) => candidate.meta.id === event.meta.id)
    ) {
      return { ...current, endIndex };
    }
    return {
      ...current,
      endIndex,
      events: [...current.events, event],
    };
  });
}

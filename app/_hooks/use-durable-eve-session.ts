"use client";

import type { UserContent } from "ai";
import {
  Client,
  defaultMessageReducer,
  type ClientSession,
  type ClientSessionState,
  type EveAgentStoreStatus,
  type EveMessageData,
  type InputResponse,
  type MessageStreamEvent,
  type RespondTurnOptions,
  type SendTurnOptions,
} from "eve/client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { followDurableSession } from "./follow-durable-session";

const messageReducer = defaultMessageReducer();

interface DurableSessionState {
  readonly activeTurnId?: string;
  readonly data: EveMessageData;
  readonly error?: Error;
  readonly events: readonly MessageStreamEvent[];
  readonly session?: ClientSessionState;
  readonly status: EveAgentStoreStatus;
}

type DurableSessionAction =
  | { readonly sessionId: string; readonly type: "connection.started" }
  | {
      readonly events: readonly MessageStreamEvent[];
      readonly session: ClientSessionState;
      readonly type: "connection.replayed";
    }
  | { readonly event: MessageStreamEvent; readonly type: "event.received" }
  | { readonly type: "command.started" }
  | { readonly error: Error; readonly type: "request.failed" };

export function useDurableEveSession({
  initialSession,
  onSessionChange,
}: {
  readonly initialSession?: ClientSessionState;
  readonly onSessionChange?: (session: ClientSessionState) => void;
}) {
  const [client] = useState(() => new Client({ host: "" }));
  const commandSessionRef = useRef<ClientSession | undefined>(undefined);
  const streamAbortRef = useRef<AbortController | undefined>(undefined);
  const streamGenerationRef = useRef(0);
  const onSessionChangeRef = useRef(onSessionChange);

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  const [state, dispatch] = useReducer(durableSessionReducer, undefined, () =>
    initialDurableSessionState(initialSession)
  );

  const followSession = useCallback(
    (sessionId: string) => {
      streamAbortRef.current?.abort();
      const abortController = new AbortController();
      const generation = streamGenerationRef.current + 1;
      streamAbortRef.current = abortController;
      streamGenerationRef.current = generation;
      commandSessionRef.current = client.sessions.attach(sessionId);
      dispatch({ sessionId, type: "connection.started" });

      void (async () => {
        try {
          const replay = await client.sessions
            .attach(sessionId)
            .snapshot({ signal: abortController.signal });
          if (
            abortController.signal.aborted ||
            streamGenerationRef.current !== generation
          ) {
            return;
          }

          dispatch({
            events: replay.events,
            session: replay.session,
            type: "connection.replayed",
          });

          const streamSession = client.sessions.attach(sessionId, {
            streamIndex: replay.session.streamIndex,
          });
          await followDurableSession(
            streamSession,
            (event) => {
              if (streamGenerationRef.current === generation) {
                dispatch({ event, type: "event.received" });
              }
            },
            abortController.signal
          );
        } catch (error) {
          if (
            !abortController.signal.aborted &&
            streamGenerationRef.current === generation
          ) {
            dispatch({ error: toError(error), type: "request.failed" });
          }
        }
      })();
    },
    [client]
  );

  const initialSessionId = initialSession?.sessionId;
  useEffect(() => {
    if (initialSessionId !== undefined) {
      followSession(initialSessionId);
    }
  }, [followSession, initialSessionId]);

  useEffect(
    () => () => {
      streamGenerationRef.current += 1;
      streamAbortRef.current?.abort();
    },
    []
  );

  const send = useCallback(
    async <TOutput = unknown>(
      message: string | UserContent,
      options?: SendTurnOptions<TOutput>
    ): Promise<void> => {
      dispatch({ type: "command.started" });

      try {
        const session = commandSessionRef.current;
        if (session !== undefined) {
          await session.send(message, options);
          return;
        }

        const created = await client.sessions.create({ message, ...options });
        const createdSession = created.session.state;
        onSessionChangeRef.current?.(createdSession);
        followSession(createdSession.sessionId);
      } catch (error) {
        dispatch({ error: toError(error), type: "request.failed" });
        throw error;
      }
    },
    [client, followSession]
  );

  const respond = useCallback(
    async <TOutput = unknown>(
      inputResponses: readonly InputResponse[],
      options?: RespondTurnOptions<TOutput>
    ): Promise<void> => {
      const session = commandSessionRef.current;
      if (session === undefined) {
        throw new Error("Cannot respond before the session starts.");
      }

      dispatch({ type: "command.started" });
      try {
        await session.respond(inputResponses, options);
      } catch (error) {
        dispatch({ error: toError(error), type: "request.failed" });
        throw error;
      }
    },
    []
  );

  const cancel = useCallback(async () => {
    const session = commandSessionRef.current;
    if (session === undefined) return { status: "no_active_turn" as const };
    return session.cancel(
      state.activeTurnId === undefined
        ? undefined
        : { turnId: state.activeTurnId }
    );
  }, [state.activeTurnId]);

  return { ...state, cancel, respond, send };
}

function initialDurableSessionState(
  session?: ClientSessionState
): DurableSessionState {
  return {
    data: messageReducer.initial(),
    events: [],
    session,
    status: session === undefined ? "ready" : "resuming",
  };
}

function durableSessionReducer(
  state: DurableSessionState,
  action: DurableSessionAction
): DurableSessionState {
  switch (action.type) {
    case "connection.started":
      return {
        ...initialDurableSessionState({
          sessionId: action.sessionId,
          streamIndex: 0,
        }),
        status: "resuming",
      };
    case "connection.replayed": {
      let replayed = initialDurableSessionState(action.session);
      for (const event of action.events) {
        replayed = reduceServerEvent(replayed, event);
      }
      return replayed;
    }
    case "event.received":
      return reduceServerEvent(state, action.event);
    case "command.started":
      return {
        ...state,
        error: undefined,
        status: state.activeTurnId === undefined ? "submitted" : "streaming",
      };
    case "request.failed":
      return { ...state, error: action.error, status: "error" };
  }
}

function reduceServerEvent(
  state: DurableSessionState,
  event: MessageStreamEvent
): DurableSessionState {
  const events = [...state.events, event];
  let next: DurableSessionState = {
    ...state,
    data: messageReducer.reduce(state.data, event),
    events,
    session:
      state.session === undefined
        ? undefined
        : { ...state.session, streamIndex: events.length },
  };

  switch (event.type) {
    case "turn.started":
      next = {
        ...next,
        activeTurnId: event.data.turnId,
        error: undefined,
        status: "streaming",
      };
      break;
    case "turn.completed":
    case "turn.cancelled":
      next = {
        ...next,
        activeTurnId: undefined,
        error: undefined,
        status: "ready",
      };
      break;
    case "turn.failed":
    case "session.failed":
      next = {
        ...next,
        activeTurnId: undefined,
        error: new Error(event.data.message),
        status: "error",
      };
      break;
    case "session.waiting":
    case "session.completed":
      next = {
        ...next,
        activeTurnId: undefined,
        status: next.error === undefined ? "ready" : "error",
      };
      break;
  }

  return next;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

import type { SessionStreamEvent } from "eve/client";
import { useEffect, useMemo, useRef } from "react";
import { summarizeChatUsage } from "../../../_lib/chat-usage";
import type { ChatUsage } from "@shared/chat/schema";
import { api } from "@web/trpc/client";

export function useChatUsage({
  events,
  historyComplete,
  initialUsage,
  sessionId,
}: {
  readonly events: readonly SessionStreamEvent[];
  readonly historyComplete: boolean;
  readonly initialUsage?: ChatUsage;
  readonly sessionId?: string;
}) {
  const { mutate: saveChat } = api.chats.save.useMutation();
  const persistedTurn = useRef<string | undefined>(undefined);
  const measuredUsage = useMemo(() => summarizeChatUsage(events), [events]);
  const usage = useMemo(
    () => preferCompleteUsage(measuredUsage, initialUsage),
    [initialUsage, measuredUsage]
  );
  const latestSettledTurn = events.findLast(
    (event) => event.type === "turn.settled"
  );
  const latestTerminalTurnId =
    latestSettledTurn?.type === "turn.settled"
      ? latestSettledTurn.data.turnId
      : undefined;

  useEffect(() => {
    if (
      !historyComplete ||
      sessionId === undefined ||
      latestTerminalTurnId === undefined
    ) {
      return;
    }

    const terminalTurn = `${sessionId}:${latestTerminalTurnId}`;
    if (persistedTurn.current === terminalTurn) return;
    persistedTurn.current = terminalTurn;
    saveChat({ sessionId, usage });
  }, [historyComplete, latestTerminalTurnId, saveChat, sessionId, usage]);

  return usage;
}

function preferCompleteUsage(measured: ChatUsage, initial?: ChatUsage) {
  if (initial === undefined) return measured;
  const initialTokens = initial.inputTokens + initial.outputTokens;
  const measuredTokens = measured.inputTokens + measured.outputTokens;
  return measuredTokens >= initialTokens ? measured : initial;
}

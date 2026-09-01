"use client";

import {
  defaultMessageReducer,
  type MessageStreamEvent,
  type SubagentCalledStreamEvent,
} from "eve/client";
import { BotIcon } from "lucide-react";
import { useMemo } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getLatestTurnFailure } from "../_lib/turn-failure";
import type { SubagentStatus } from "@/app/_lib/subagent-sessions";
import { AgentMessage } from "./agent-message";

const messageReducer = defaultMessageReducer();

export function SubagentTrace({
  events,
  streamError,
  status,
  target,
}: {
  readonly events: readonly MessageStreamEvent[];
  readonly streamError?: string;
  readonly status: SubagentStatus;
  readonly target: SubagentCalledStreamEvent["data"];
}) {
  const data = useMemo(
    () =>
      events.reduce(
        (current, event) => messageReducer.reduce(current, event),
        messageReducer.initial()
      ),
    [events]
  );
  const timestamps = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of events) {
      if (event.type === "message.received") {
        values.set(`${event.data.turnId}:user`, event.meta.at);
      }
      if (
        event.type === "message.completed" &&
        event.data.finishReason !== "tool-calls"
      ) {
        values.set(`${event.data.turnId}:assistant`, event.meta.at);
      }
    }
    return values;
  }, [events]);
  const isRunning = status === "starting" || status === "working";
  const turnFailure = useMemo(() => getLatestTurnFailure(events), [events]);
  const error = streamError ?? turnFailure;
  const statusLabel = error ? "Failed" : isRunning ? "Running" : status;
  const badgeVariant = error
    ? "destructive"
    : isRunning
      ? "information"
      : "secondary";
  const alertVariant = error
    ? "destructive"
    : isRunning
      ? "information"
      : "default";

  return (
    <section className="py-4">
      <Alert variant={alertVariant}>
        <BotIcon />
        <AlertTitle>{target.name} trace</AlertTitle>
        <AlertAction>
          <Badge variant={badgeVariant}>{statusLabel}</Badge>
        </AlertAction>
      </Alert>
      <div className="space-y-5 py-5">
        {data.messages.map((message, index) => (
          <AgentMessage
            canRespond={false}
            isStreaming={isRunning && index === data.messages.length - 1}
            key={message.id}
            message={message}
            onInputResponses={() => undefined}
            timestamp={timestamps.get(message.id)}
          />
        ))}
        {isRunning && data.messages.length === 0 ? (
          <Shimmer className="type-supporting-body" duration={1}>
            Loading task trace
          </Shimmer>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}

"use client";

import {
  defaultMessageReducer,
  type MessageStreamEvent,
  type SubagentCalledStreamEvent,
} from "eve/client";
import { BotIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo } from "react";
import { Shimmer } from "@web/components/ai-elements/shimmer";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { getLatestTurnFailure } from "../../_lib/turn-failure";
import { messageTimestamps } from "../../_lib/message-events";
import type { SubagentStatus } from "@app/_lib/subagent-sessions";
import { AgentMessage } from "../conversation/message";

const messageReducer = defaultMessageReducer();

export function SubagentTrace({
  events,
  hasOlder,
  isLoading,
  isLoadingOlder,
  loadOlder,
  streamError,
  status,
  target,
}: {
  readonly events: readonly MessageStreamEvent[];
  readonly hasOlder: boolean;
  readonly isLoading: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => Promise<void>;
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
  const timestamps = useMemo(() => messageTimestamps(events), [events]);
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
        {hasOlder ? (
          <Button
            className="mx-auto flex"
            disabled={isLoadingOlder}
            onClick={() => void loadOlder()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isLoadingOlder ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {isLoadingOlder ? "Loading…" : "Load older messages"}
          </Button>
        ) : null}
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
        {(isLoading || isRunning) && data.messages.length === 0 ? (
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

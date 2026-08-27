"use client";

import type { SubagentCalledStreamEvent } from "eve/client";
import { useEveAgent } from "eve/react";
import { BotIcon } from "lucide-react";
import { useMemo } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { getLatestTurnFailure } from "@/app/_lib/turn-failure";
import { AgentMessage } from "./agent-message";

export function SubagentTrace({
  target,
}: {
  readonly target: SubagentCalledStreamEvent["data"];
}) {
  const trace = useEveAgent({
    initialSession: { sessionId: target.childSessionId, streamIndex: 0 },
    resume: true,
  });
  const timestamps = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of trace.events) {
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
  }, [trace.events]);
  const isRunning =
    trace.status === "resuming" ||
    trace.status === "submitted" ||
    trace.status === "streaming";
  const turnFailure = useMemo(
    () => getLatestTurnFailure(trace.events),
    [trace.events]
  );
  const error = trace.error?.message ?? turnFailure;
  const status = error ? "Failed" : isRunning ? "Running" : "Settled";
  const badgeVariant = error
    ? "destructive"
    : isRunning
      ? "information"
      : "secondary";

  return (
    <section className="mt-3 overflow-hidden rounded-lg border bg-muted/20">
      <header className="flex items-center gap-2 px-3 py-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate type-label">
          {target.name} trace
        </span>
        <Badge variant={badgeVariant}>{status}</Badge>
      </header>
      <div className="space-y-4 border-t px-3 py-3">
        {trace.data.messages.map((message, index) => (
          <AgentMessage
            canRespond={false}
            isStreaming={
              trace.status === "streaming" &&
              index === trace.data.messages.length - 1
            }
            key={message.id}
            message={message}
            onInputResponses={() => undefined}
            timestamp={timestamps.get(message.id)}
          />
        ))}
        {isRunning && trace.data.messages.length === 0 ? (
          <Shimmer className="type-supporting-body" duration={1}>
            Loading task trace
          </Shimmer>
        ) : null}
        {error ? (
          <p className="type-supporting-body text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

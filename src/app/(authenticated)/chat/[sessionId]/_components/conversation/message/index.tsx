"use client";

import type { EveMessage } from "eve/react";
import { useState } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { AgentMessagePart, partKey } from "./parts";
import type { RespondToAgentInput } from "./types";

export function AgentMessage({
  canRespond,
  deliveredAssistantMessages,
  isStreaming,
  message,
  onInputResponses,
  timestamp,
  userVisibleOnly = false,
}: {
  readonly canRespond: boolean;
  readonly deliveredAssistantMessages?: ReadonlyMap<number, readonly string[]>;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: RespondToAgentInput;
  readonly timestamp?: string;
  readonly userVisibleOnly?: boolean;
}) {
  const [optimisticTimestamp] = useState(() => new Date().toISOString());
  const displayedTimestamp =
    timestamp ?? (message.role === "user" ? optimisticTimestamp : undefined);
  const visibleParts = userVisibleOnly
    ? userVisibleParts(message, deliveredAssistantMessages)
    : message.parts;
  const lastTextIndex = visibleParts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1
  );
  const hasAssistantText =
    message.role === "assistant" &&
    visibleParts.some((part) => part.type === "text" && part.text.length > 0);

  if (visibleParts.length === 0) return null;

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {visibleParts.map((part, index) =>
          hasAssistantText && part.type === "reasoning" ? null : (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              showCaret={
                isStreaming &&
                message.role === "assistant" &&
                index === lastTextIndex
              }
              userVisibleOnly={userVisibleOnly}
            />
          )
        )}
      </MessageContent>
      {displayedTimestamp ? (
        <time
          className={cn(
            "text-muted-foreground",
            message.role === "user" ? "ml-auto pr-1" : "mr-auto"
          )}
          dateTime={displayedTimestamp}
          title={fullTimestampFormatter.format(new Date(displayedTimestamp))}
        >
          <span className="type-caption" suppressHydrationWarning>
            {timestampFormatter.format(new Date(displayedTimestamp))}
          </span>
        </time>
      ) : null}
    </Message>
  );
}

function userVisibleParts(
  message: EveMessage,
  deliveredAssistantMessages?: ReadonlyMap<number, readonly string[]>
) {
  if (message.role === "user") {
    return message.parts.filter(
      (part) => part.type === "text" || part.type === "file"
    );
  }

  const remainingDeliveries = new Map(
    [...(deliveredAssistantMessages ?? [])].map(([stepIndex, messages]) => [
      stepIndex,
      [...messages],
    ])
  );

  return message.parts.filter((part) => {
    if (part.type === "text" && part.stepIndex !== undefined) {
      const deliveries = remainingDeliveries.get(part.stepIndex);
      const deliveryIndex = deliveries?.indexOf(part.text) ?? -1;
      if (deliveryIndex < 0 || !deliveries) return false;
      deliveries.splice(deliveryIndex, 1);
      return true;
    }

    if (part.type === "authorization") return true;
    return (
      part.type === "dynamic-tool" &&
      part.toolMetadata?.eve?.inputRequest !== undefined
    );
  });
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

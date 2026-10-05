"use client";

import { useState } from "react";
import { Message, MessageContent } from "@web/components/ai-elements/message";
import { cn } from "@web/components/class-names";
import { AgentMessagePart, partKey } from "./parts";
import type { RespondToAgentInput } from "./types";
import type { ConversationRow } from "../../../_lib/conversation-rows";

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  userVisibleOnly = false,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: ConversationRow;
  readonly onInputResponses: RespondToAgentInput;
  readonly userVisibleOnly?: boolean;
}) {
  const [optimisticTimestamp] = useState(() => new Date().toISOString());
  const displayedTimestamp =
    message.timestamp ??
    (message.role === "user" ? optimisticTimestamp : undefined);
  const visibleParts = message.parts;
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
      id={message.id}
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.reply ? <ReplyPreview reply={message.reply} /> : null}
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
      {message.reactions?.length ? (
        <ul
          aria-label="Reactions"
          className={cn(
            "flex gap-1",
            message.role === "user" ? "ml-auto" : "mr-auto"
          )}
        >
          {message.reactions.map((emoji) => (
            <li
              key={emoji}
              aria-label={`Reaction ${emoji}`}
              className="type-supporting-body rounded-full bg-muted px-2 py-1"
            >
              {emoji}
            </li>
          ))}
        </ul>
      ) : null}
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

function ReplyPreview({
  reply,
}: {
  readonly reply: NonNullable<ConversationRow["reply"]>;
}) {
  const content = (
    <>
      {reply.image?.url ? (
        // oxlint-disable-next-line nextjs/no-img-element -- provider attachment URLs are resolved at runtime
        <img
          alt={reply.image.filename ?? "Quoted image"}
          src={reply.image.url}
          className="size-10 shrink-0 rounded-sm object-cover"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block type-caption">Reply to</span>
        <span className="type-supporting-body block truncate">
          {reply.text}
        </span>
      </span>
    </>
  );
  const className =
    "flex max-w-sm items-center gap-2 border-l-2 border-border pl-3 text-muted-foreground";
  return reply.targetId ? (
    <a
      aria-label={`Reply to ${reply.text}`}
      className={className}
      href={`#${encodeURIComponent(reply.targetId)}`}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

import { AlertCircleIcon, BrainIcon } from "lucide-react";
import { useMemo } from "react";
import {
  deliveredAssistantMessages,
  messageTimestamps,
} from "../../_lib/message-events";
import { messagesForTraceView, type TraceView } from "../../_lib/trace-view";
import { getLatestTurnFailure } from "../../_lib/turn-failure";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AgentMessage } from "./message";
import type { ChatAgent } from "../chat-agent";

export function ChatConversation({
  agent,
  initial,
  sessionId,
  traceView,
}: {
  readonly agent: Pick<
    ChatAgent,
    "data" | "error" | "events" | "respond" | "status"
  >;
  readonly initial?: false;
  readonly sessionId?: string;
  readonly traceView: TraceView;
}) {
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isRestoring =
    agent.status === "resuming" && agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const pendingAssistantMessageId =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start")
      ? lastMessage.id
      : undefined;
  const showPendingThinking =
    isBusy &&
    (traceView === "imessage" ||
      agent.status === "submitted" ||
      lastMessage?.role !== "assistant" ||
      pendingAssistantMessageId !== undefined);
  const turnFailure =
    isBusy || isRestoring ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage =
    (agent.error ? toErrorMessage(agent.error) : undefined) ?? turnFailure;
  const messages = useMemo(
    () => messagesForTraceView(agent.data.messages, agent.events, traceView),
    [agent.data.messages, agent.events, traceView]
  );
  const timestamps = useMemo(
    () => messageTimestamps(agent.events),
    [agent.events]
  );
  const deliveredMessages = useMemo(
    () => deliveredAssistantMessages(agent.events),
    [agent.events]
  );

  return (
    <Conversation
      className="min-h-0 flex-1"
      initial={initial}
      resize={sessionId === undefined ? "smooth" : "instant"}
      scrollRestorationKey={
        agent.data.messages.length === 0 || sessionId === undefined
          ? undefined
          : `eve:web-chat-scroll:${sessionId}`
      }
    >
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-36 sm:px-6">
        {messages.map((message, index) =>
          showPendingThinking &&
          message.id === pendingAssistantMessageId ? null : (
            <AgentMessage
              canRespond={!isBusy && agent.status !== "resuming"}
              deliveredAssistantMessages={deliveredMessages.get(message.id)}
              isStreaming={
                agent.status === "streaming" && index === messages.length - 1
              }
              key={message.id}
              message={message}
              onInputResponses={(responses) => agent.respond(responses)}
              timestamp={timestamps.get(message.id)}
              userVisibleOnly={traceView === "imessage"}
            />
          )
        )}
        {showPendingThinking ? <PendingThinking /> : null}
        {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function toErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) return "Unable to complete the request.";
  if (/<!doctype html|<html[\s>]/i.test(cause.message)) {
    return "The agent runtime is unavailable. Try again in a moment.";
  }
  return cause.message;
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </MessageContent>
    </Message>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="type-supporting-body mb-4 flex w-full items-center gap-2 text-muted-foreground">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

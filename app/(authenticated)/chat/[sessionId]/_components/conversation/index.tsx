import { AlertCircleIcon, BrainIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo } from "react";
import type { TraceView } from "../../_lib/trace-view";
import { getLatestTurnFailure } from "../../_lib/turn-failure";
import { conversationRows } from "../../_lib/conversation-rows";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@web/components/ai-elements/conversation";
import { Message, MessageContent } from "@web/components/ai-elements/message";
import { Shimmer } from "@web/components/ai-elements/shimmer";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { AgentMessage } from "./message";
import type { ChatAgent } from "../chat-agent";

export function ChatConversation({
  agent,
  history,
  initial,
  sessionId,
  traceView,
}: {
  readonly agent: Pick<
    ChatAgent,
    "data" | "error" | "events" | "respond" | "status"
  >;
  readonly history?: {
    readonly hasOlder: boolean;
    readonly isLoadingOlder: boolean;
    readonly loadOlder: () => Promise<void>;
  };
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
    traceView === "trace" &&
    isBusy &&
    (agent.status === "submitted" ||
      lastMessage?.role !== "assistant" ||
      pendingAssistantMessageId !== undefined);
  const turnFailure =
    isBusy || isRestoring ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage =
    (agent.error ? toErrorMessage(agent.error) : undefined) ?? turnFailure;
  const messages = useMemo(
    () => conversationRows(agent.data.messages, agent.events, traceView),
    [agent.data.messages, agent.events, traceView]
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
        {history?.hasOlder ? (
          <Button
            className="self-center"
            disabled={history.isLoadingOlder}
            onClick={() => void history.loadOlder()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {history.isLoadingOlder ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {history.isLoadingOlder ? "Loading…" : "Load older messages"}
          </Button>
        ) : null}
        {isRestoring && messages.length === 0 ? (
          <Shimmer className="type-supporting-body self-center" duration={1}>
            Loading recent messages
          </Shimmer>
        ) : null}
        {messages.map((message, index) => {
          if (showPendingThinking && message.id === pendingAssistantMessageId) {
            return null;
          }

          return (
            <AgentMessage
              canRespond={!isBusy && agent.status !== "resuming"}
              isStreaming={
                traceView === "trace" &&
                agent.status === "streaming" &&
                index === messages.length - 1
              }
              key={message.id}
              message={message}
              onInputResponses={(responses) => agent.respond(responses)}
              userVisibleOnly={traceView === "imessage"}
            />
          );
        })}
        {showPendingThinking ? <PendingThinking /> : null}
        {traceView === "trace" && errorMessage ? (
          <ErrorMessage message={errorMessage} />
        ) : null}
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

"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, BrainIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { formatChatUsage, summarizeChatUsage } from "@/app/_lib/chat-usage";
import { getLatestTurnFailure } from "@/app/_lib/turn-failure";
import type { ChatUsage } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { SubagentTrace } from "./subagent-trace";

const AGENT_NAME = "Local Vault Assistant";

export function AgentChat({
  initialUsage,
  sessionId,
  sessionless = false,
}: {
  readonly initialUsage?: ChatUsage;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const [cancellationError, setCancellationError] = useState<string>();
  const [traceView, setTraceView] = useState<"imessage" | "trace">("trace");
  const pendingChatTitle = useRef<string | undefined>(undefined);
  const agent = useEveAgent({
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (sessionId === undefined && session !== undefined) {
        void saveChat(session.sessionId, pendingChatTitle.current).catch(
          () => undefined
        );
        pendingChatTitle.current = undefined;
        // Next patches window.history to navigate, which would detach the active stream.
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/chat/${encodeURIComponent(session.sessionId)}`
        );
      }
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isRestoring = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (traceView === "imessage" ||
      agent.status === "submitted" ||
      lastMessage?.role !== "assistant" ||
      isPendingAssistantShell);
  const turnFailure =
    isBusy || isRestoring ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage =
    cancellationError ??
    (agent.error ? toErrorMessage(agent.error) : undefined) ??
    turnFailure;
  const hasConversationContent =
    sessionless || !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isRestoring || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  const measuredUsage = useMemo(
    () => summarizeChatUsage(agent.events),
    [agent.events]
  );
  const usage = useMemo(
    () => preferCompleteUsage(measuredUsage, initialUsage),
    [initialUsage, measuredUsage]
  );
  const latestTerminalTurnAt = agent.events.findLast(
    (event) =>
      event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.cancelled"
  )?.meta.at;
  const messageTimestamps = useMemo(() => {
    const timestamps = new Map<string, string>();

    for (const event of agent.events) {
      if (event.type === "message.received") {
        timestamps.set(`${event.data.turnId}:user`, event.meta.at);
      }

      if (
        event.type === "message.completed" &&
        event.data.finishReason !== "tool-calls"
      ) {
        timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
      }
    }

    return timestamps;
  }, [agent.events]);
  const deliveredAssistantMessages = useMemo(() => {
    const deliveriesByMessage = new Map<string, Map<number, string[]>>();

    for (const event of agent.events) {
      if (
        event.type !== "message.completed" ||
        event.data.finishReason === "tool-calls" ||
        !event.data.message?.trim()
      ) {
        continue;
      }

      const messageId = `${event.data.turnId}:assistant`;
      const deliveries =
        deliveriesByMessage.get(messageId) ?? new Map<number, string[]>();
      const messages = deliveries.get(event.data.stepIndex) ?? [];
      messages.push(event.data.message);
      deliveries.set(event.data.stepIndex, messages);
      deliveriesByMessage.set(messageId, deliveries);
    }

    return deliveriesByMessage;
  }, [agent.events]);
  const subagentTraces = useMemo(() => {
    const traces = new Map<string, ReactNode>();

    for (const event of agent.events) {
      if (event.type !== "subagent.called") continue;
      traces.set(
        event.data.callId,
        <SubagentTrace key={event.data.childSessionId} target={event.data} />
      );
    }

    return traces;
  }, [agent.events]);

  useEffect(() => {
    if (activeSessionId === undefined || latestTerminalTurnAt === undefined) {
      return;
    }

    void saveChat(activeSessionId, undefined, usage).catch(() => undefined);
  }, [activeSessionId, latestTerminalTurnAt, usage]);

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isRestoring)
      return;

    setCancellationError(undefined);
    const options = isBusy ? { turnPolicy: "steer" as const } : undefined;
    const title = chatTitle(message);
    if (activeSessionId) {
      void saveChat(activeSessionId).catch(() => undefined);
    } else {
      pendingChatTitle.current = title;
    }

    if (message.files.length === 0) {
      await agent.send(text, options);
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputBody>
        <PromptInputTextarea
          disabled={isRestoring}
          placeholder="Send a message…"
          className="min-h-0"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools />
        <PromptInputSubmit
          disabled={isRestoring}
          onStop={requestCancellation}
          status={isRestoring ? undefined : agent.status}
        />
      </PromptInputFooter>
    </PromptInput>
  );

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {showConversationLayout ? (
        <ChatHeader
          canStartNewChat={activeSessionId !== undefined}
          onTraceViewChange={setTraceView}
          traceView={traceView}
          usage={usage}
        />
      ) : null}

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `eve:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
            {agent.data.messages.map((message, index) =>
              showPendingThinking &&
              isPendingAssistantShell &&
              message.id === lastMessage.id ? null : (
                <AgentMessage
                  afterToolCalls={
                    traceView === "trace" ? subagentTraces : undefined
                  }
                  canRespond={!isBusy && !isRestoring}
                  deliveredAssistantMessages={deliveredAssistantMessages.get(
                    message.id
                  )}
                  isStreaming={
                    agent.status === "streaming" &&
                    index === agent.data.messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  onInputResponses={(inputResponses) => {
                    setCancellationError(undefined);
                    return agent.respond(inputResponses);
                  }}
                  timestamp={messageTimestamps.get(message.id)}
                  userVisibleOnly={traceView === "imessage"}
                />
              )
            )}
            {showPendingThinking ? <PendingThinking /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "absolute bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
            : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
        )}
      >
        {showConversationLayout ? null : (
          <div className="flex flex-col items-start gap-3">
            <h1 className="text-5xl font-medium tracking-tighter">
              {AGENT_NAME}
            </h1>
          </div>
        )}
        <div className="w-full">{composer}</div>
      </div>
    </main>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ChatHeader({
  canStartNewChat,
  onTraceViewChange,
  traceView,
  usage,
}: {
  readonly canStartNewChat: boolean;
  readonly onTraceViewChange: (view: "imessage" | "trace") => void;
  readonly traceView: "imessage" | "trace";
  readonly usage: ChatUsage;
}) {
  return (
    <header className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-14">
      <div className="relative mx-auto flex h-full w-full max-w-3xl items-center justify-start bg-background px-4">
        <div className="min-w-0">
          <span className="block truncate text-sm text-muted-foreground">
            {AGENT_NAME}
          </span>
          <span className="block type-label text-muted-foreground">
            Usage {formatChatUsage(usage)}
          </span>
        </div>
        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <ButtonGroup aria-label="Trace view">
            <Button
              aria-pressed={traceView === "imessage"}
              onClick={() => onTraceViewChange("imessage")}
              size="sm"
              type="button"
              variant={traceView === "imessage" ? "secondary" : "outline"}
            >
              iMessage
            </Button>
            <Button
              aria-pressed={traceView === "trace"}
              onClick={() => onTraceViewChange("trace")}
              size="sm"
              type="button"
              variant={traceView === "trace" ? "secondary" : "outline"}
            >
              Full trace
            </Button>
          </ButtonGroup>
          {canStartNewChat ? (
            <Button
              aria-label="Start a new chat"
              onClick={() => window.location.assign("/chat")}
              size="sm"
              type="button"
              variant="ghost"
            >
              <PlusIcon className="size-4" />
              <span className="hidden sm:inline">New chat</span>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-sm text-muted-foreground">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function toErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unable to complete the request.";
  if (/<!doctype html|<html[\s>]/i.test(error.message)) {
    return "The agent runtime is unavailable. Try again in a moment.";
  }
  return error.message;
}

function chatTitle(message: PromptInputMessage) {
  const text = message.text.trim();
  if (text) return text.slice(0, 240);
  return message.files[0]?.filename?.slice(0, 240) ?? "New chat";
}

function preferCompleteUsage(measured: ChatUsage, initial?: ChatUsage) {
  if (initial === undefined) return measured;

  const initialTokens = initial.inputTokens + initial.outputTokens;
  const measuredTokens = measured.inputTokens + measured.outputTokens;
  return measuredTokens >= initialTokens ? measured : initial;
}

async function saveChat(sessionId: string, title?: string, usage?: ChatUsage) {
  await fetch("/api/chats", {
    body: JSON.stringify({ sessionId, title, usage }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

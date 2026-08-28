"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import {
  ArrowLeftIcon,
  BrainIcon,
  BugIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentMessage } from "./agent-message";

const DEBUG_CLIENT_CONTEXT = {
  mode: "tool-debug",
  route: "/debug-chat",
  execution: "root-agent-only",
} as const;

export function DebugAgentChat({ sessionId }: { readonly sessionId?: string }) {
  const agent = useEveAgent({
    headers: { "x-eve-debug-direct": "1" },
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    onSessionChange(session) {
      if (sessionId === undefined && session !== undefined) {
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/debug-chat/${encodeURIComponent(session.sessionId)}`
        );
      }
    },
    resume: sessionId !== undefined,
  });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const lastMessage = agent.data.messages.at(-1);
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" ||
      lastMessage?.role !== "assistant" ||
      lastMessage.parts.every(
        (part) => part.type === "reasoning" || part.type === "step-start"
      ));
  const toolCallCount = agent.data.messages.reduce(
    (count, message) =>
      count +
      message.parts.filter((part) => part.type === "dynamic-tool").length,
    0
  );
  const messageTimestamps = useMemo(() => {
    const timestamps = new Map<string, string>();

    for (const event of agent.events) {
      if (event.type === "message.received") {
        timestamps.set(`${event.data.turnId}:user`, event.meta.at);
      }
      if (event.type === "message.completed") {
        timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
      }
    }

    return timestamps;
  }, [agent.events]);

  async function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim();
    if (text.length === 0 && message.files.length === 0) return;

    const options = {
      clientContext: DEBUG_CLIENT_CONTEXT,
      ...(isBusy ? { turnPolicy: "steer" as const } : {}),
    };

    if (message.files.length === 0) {
      await agent.send(text, options);
      return;
    }

    const parts: UserContent = [];
    if (text) parts.push({ text, type: "text" });
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }
    await agent.send(parts, options);
  }

  return (
    <main className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button
          nativeButton={false}
          render={<Link href="/chat" />}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon />
          <span className="sr-only">Back to chat</span>
        </Button>
        <BugIcon className="size-4 text-warning" />
        <div className="min-w-0">
          <h1 className="type-label">Tool debug</h1>
          <p className="truncate type-caption text-muted-foreground">
            Direct root execution · compact tool names
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={isBusy ? "warning" : "outline"}>{agent.status}</Badge>
          <Badge variant="secondary">{toolCallCount} tools</Badge>
          <Button
            onClick={() => window.location.reload()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon />
            Reset
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <section className="relative flex h-full min-h-0 flex-col overflow-hidden">
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-6 pb-36 sm:px-6">
              {agent.data.messages.length === 0 ? (
                <div className="mx-auto mt-[18vh] max-w-lg rounded-xl border border-dashed p-6 text-center">
                  <p className="type-card-title">Direct local session</p>
                  <p className="type-supporting-body mt-2 text-muted-foreground">
                    Ask the agent to open a checkout, inspect autofill, or fill
                    the development test card. Each tool call appears inline by
                    name; arguments and raw events stay hidden.
                  </p>
                </div>
              ) : null}
              {agent.data.messages.map((message, index) => (
                <AgentMessage
                  canRespond={!isBusy}
                  debug
                  isStreaming={
                    agent.status === "streaming" &&
                    index === agent.data.messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  onInputResponses={(responses) =>
                    agent.respond(responses, {
                      clientContext: DEBUG_CLIENT_CONTEXT,
                    })
                  }
                  timestamp={messageTimestamps.get(message.id)}
                />
              ))}
              {showPendingThinking ? <PendingThinking /> : null}
              {agent.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {agent.error.message}
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="absolute right-0 bottom-0 left-0 z-20 bg-gradient-to-t from-background via-background to-transparent px-4 pt-5 pb-5 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <PromptInput onSubmit={handleSubmit}>
                <PromptInputTextarea placeholder="Run a checkout test…" />
                {isBusy ? (
                  <PromptInputButton
                    aria-label="Stop"
                    className="absolute right-12 bottom-2.5 rounded-full"
                    onClick={() => void agent.cancel()}
                    variant="default"
                  >
                    <SquareIcon className="size-3 fill-current" />
                  </PromptInputButton>
                ) : null}
                <PromptInputSubmit status={isBusy ? undefined : agent.status} />
              </PromptInput>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="flex items-center gap-1.5 type-caption text-muted-foreground/70">
          <BrainIcon className="size-3.5" />
          <Shimmer duration={1.5}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

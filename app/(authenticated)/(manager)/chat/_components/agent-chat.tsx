"use client";

import type { UserContent } from "ai";
import type { MessageStreamEvent } from "eve/client";
import { useEveAgent, type EveMessage } from "eve/react";
import { AlertCircleIcon, BrainIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/trpc/client";
import { z } from "zod";
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
import { summarizeChatUsage } from "@/app/(authenticated)/(manager)/_lib/chat-usage";
import { getLatestTurnFailure } from "@/app/(authenticated)/(manager)/chat/_lib/turn-failure";
import type { ChatUsage } from "@/lib/chat";
import { parseWorkerTaskNotification } from "@/lib/eve-task-notifications";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { collectSubagentSessions } from "@/app/_lib/subagent-sessions";
import { SubagentPanel } from "./subagent-panel";

const AGENT_NAME = "Local Vault Assistant";
const taskCancelResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: z.object({ tasks: z.array(z.unknown()) }),
  toolName: z.literal("task_cancel"),
});
const cancelledWorkerTaskSchema = z.object({
  metadata: z.object({ name: z.literal("worker") }),
  status: z.literal("cancelled"),
  taskId: z.string(),
});

export function AgentChat({
  initialUsage,
  sessionId,
  sessionless = false,
}: {
  readonly initialUsage?: ChatUsage;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const { mutate: saveChat } = api.chats.save.useMutation();
  const [traceView, setTraceView] = useState<"imessage" | "trace">("imessage");
  const backgroundCatchUp = useRef<Promise<void> | undefined>(undefined);
  const pendingChatTitle = useRef<string | undefined>(undefined);
  const persistedUsageTurn = useRef<string | undefined>(undefined);
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
        saveChat({
          sessionId: session.sessionId,
          title: pendingChatTitle.current,
        });
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
  const isSubmitting = agent.status === "submitted";
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const isRestoring = isResuming && isEmpty;
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
    (agent.error ? toErrorMessage(agent.error) : undefined) ?? turnFailure;
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
  const latestTerminalTurnId = agent.events.findLast(
    (event) =>
      event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.cancelled"
  )?.meta.id;
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
  const subagentSessions = useMemo(
    () => collectSubagentSessions(agent.events),
    [agent.events]
  );
  const hasPendingWorker = useMemo(
    () => hasPendingBackgroundWorker(agent.events),
    [agent.events]
  );
  const messages = useMemo(
    () => messagesForTraceView(agent.data.messages, agent.events, traceView),
    [agent.data.messages, agent.events, traceView]
  );

  useEffect(() => {
    if (activeSessionId === undefined || latestTerminalTurnId === undefined) {
      return;
    }

    const terminalTurn = `${activeSessionId}:${latestTerminalTurnId}`;
    if (persistedUsageTurn.current === terminalTurn) return;
    persistedUsageTurn.current = terminalTurn;
    saveChat({ sessionId: activeSessionId, usage });
  }, [activeSessionId, latestTerminalTurnId, saveChat, usage]);

  useEffect(() => {
    if (activeSessionId === undefined || !hasPendingWorker) return;

    const interval = window.setInterval(() => {
      if (agent.status !== "ready" || backgroundCatchUp.current !== undefined) {
        return;
      }

      const catchUp = agent.resume().catch(() => undefined);
      backgroundCatchUp.current = catchUp;
      void catchUp.finally(() => {
        if (backgroundCatchUp.current === catchUp) {
          backgroundCatchUp.current = undefined;
        }
      });
    }, 750);

    return () => window.clearInterval(interval);
  }, [activeSessionId, agent, hasPendingWorker]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (
      (text.length === 0 && message.files.length === 0) ||
      isSubmitting ||
      isRestoring
    )
      return;

    const catchUp = backgroundCatchUp.current;
    if (catchUp !== undefined) {
      await Promise.all([agent.cancel().catch(() => undefined), catchUp]);
    }

    const options =
      isBusy || catchUp !== undefined
        ? { turnPolicy: "steer" as const }
        : undefined;
    const title = chatTitle(message);
    if (activeSessionId) {
      saveChat({ sessionId: activeSessionId });
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
          disabled={isSubmitting}
          placeholder="Send a message…"
          className="min-h-0"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools />
        <PromptInputSubmit
          disabled={isRestoring}
          onStop={() => void agent.cancel()}
          status={isBusy ? agent.status : undefined}
        />
      </PromptInputFooter>
    </PromptInput>
  );

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
            <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-36 sm:px-6">
              {messages.map((message, index) =>
                showPendingThinking &&
                isPendingAssistantShell &&
                message.id === lastMessage.id ? null : (
                  <AgentMessage
                    canRespond={!isBusy && !isResuming}
                    deliveredAssistantMessages={deliveredAssistantMessages.get(
                      message.id
                    )}
                    isStreaming={
                      agent.status === "streaming" &&
                      index === messages.length - 1
                    }
                    key={message.id}
                    message={message}
                    onInputResponses={(inputResponses) =>
                      agent.respond(inputResponses)
                    }
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
      </div>
      <SubagentPanel
        onTraceViewChange={setTraceView}
        sessions={subagentSessions}
        traceView={traceView}
        usage={usage}
      />
    </div>
  );
}

export function messagesForTraceView(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  traceView: "imessage" | "trace"
) {
  if (traceView === "trace") return messages;
  const hiddenMessageIds = backgroundWorkerDeliveryMessageIds(events);
  return messages.filter((message) => !hiddenMessageIds.has(message.id));
}

export function backgroundWorkerDeliveryMessageIds(
  events: readonly MessageStreamEvent[]
) {
  // Eve task deliveries currently share message.received with user input, so
  // require both its exact framework grammar and a receipt from this worker.
  const taskIds = new Set<string>();
  const cancelledTaskIds = new Set<string>();

  for (const event of events) {
    if (
      event.type === "subagent.completed" &&
      event.data.subagentName === "worker" &&
      event.data.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.backgroundTask.taskId);
      continue;
    }

    if (
      event.type === "action.result" &&
      event.data.result.kind === "subagent-result" &&
      event.data.result.subagentName === "worker" &&
      event.data.result.origin === "child" &&
      event.data.result.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.result.backgroundTask.taskId);
    }
  }

  const messageIds = new Set<string>();
  for (const event of events) {
    if (event.type === "action.result") {
      const result = taskCancelResultSchema.safeParse(event.data.result);
      if (!result.success) continue;
      for (const value of result.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) cancelledTaskIds.add(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received") continue;
    const notification = parseWorkerTaskNotification(event.data.message);
    const taskId = notification?.taskId;
    if (taskId && taskIds.has(taskId)) {
      const isCancellation = notification.kind === "cancelled";
      if (!isCancellation) messageIds.add(`${event.data.turnId}:user`);
      if (isCancellation && cancelledTaskIds.delete(taskId)) {
        messageIds.add(`${event.data.turnId}:user`);
        messageIds.add(`${event.data.turnId}:assistant`);
      }
    }
  }

  return messageIds;
}

function hasPendingBackgroundWorker(events: readonly MessageStreamEvent[]) {
  const taskIds = new Set<string>();

  for (const event of events) {
    if (
      event.type === "subagent.completed" &&
      event.data.subagentName === "worker" &&
      event.data.backgroundTask !== undefined
    ) {
      taskIds.add(event.data.backgroundTask.taskId);
      continue;
    }

    if (event.type === "action.result") {
      const result = event.data.result;
      if (
        result.kind === "subagent-result" &&
        result.subagentName === "worker" &&
        result.origin === "child" &&
        result.backgroundTask !== undefined
      ) {
        taskIds.add(result.backgroundTask.taskId);
        continue;
      }

      const cancellation = taskCancelResultSchema.safeParse(result);
      if (!cancellation.success) continue;
      for (const value of cancellation.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) taskIds.delete(task.data.taskId);
      }
      continue;
    }

    if (event.type !== "message.received") continue;
    const notification = parseWorkerTaskNotification(event.data.message);
    if (notification && notification.kind !== "update") {
      taskIds.delete(notification.taskId);
    }
  }

  return taskIds.size > 0;
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

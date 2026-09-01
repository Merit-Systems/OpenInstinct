"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import {
  ChevronRightIcon,
  ListTreeIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getSubagentStatus,
  getSubagentSubscriptionKey,
  getSubagentTask,
  type SubagentSession,
  type SubagentStatus,
} from "@/app/_lib/subagent-sessions";
import { formatChatUsage } from "@/app/(authenticated)/chat/_lib/chat-usage";
import type { ChatUsage } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { SubagentTrace } from "./subagent-trace";

const client = new Client({ host: "" });

export function SubagentPanel({
  onTraceViewChange,
  sessions,
  traceView,
  usage,
}: {
  readonly onTraceViewChange: (view: "imessage" | "trace") => void;
  readonly sessions: readonly SubagentSession[];
  readonly traceView: "imessage" | "trace";
  readonly usage: ChatUsage;
}) {
  const [eventsBySession, setEventsBySession] = useState<
    ReadonlyMap<string, readonly MessageStreamEvent[]>
  >(new Map());
  const [streamErrors, setStreamErrors] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const traceCloseButton = useRef<HTMLButtonElement>(null);
  const restoreFocusId = useRef<string | undefined>(undefined);
  const subscriptionKey = getSubagentSubscriptionKey(sessions);

  useEffect(() => {
    if (!subscriptionKey) return undefined;
    const controllers = subscriptionKey.split("\n").map((subscription) => {
      const [encodedSessionId] = subscription.split(":");
      const childSessionId = decodeURIComponent(encodedSessionId ?? "");
      const controller = new AbortController();
      const child = client.sessions.attach(childSessionId);

      void (async () => {
        try {
          const snapshot = await child.snapshot({ signal: controller.signal });
          if (controller.signal.aborted) return;

          setStreamErrors((current) => {
            if (!current.has(childSessionId)) return current;
            const next = new Map(current);
            next.delete(childSessionId);
            return next;
          });
          setEventsBySession((current) => {
            const next = new Map(current);
            next.set(childSessionId, snapshot.events);
            return next;
          });

          const liveChild = client.sessions.attach(childSessionId, {
            streamIndex: snapshot.session.streamIndex,
          });
          for await (const event of liveChild.stream({
            signal: controller.signal,
          })) {
            setEventsBySession((current) => {
              const events = current.get(childSessionId) ?? [];
              if (
                events.some((candidate) => candidate.meta.id === event.meta.id)
              ) {
                return current;
              }
              const next = new Map(current);
              next.set(childSessionId, [...events, event]);
              return next;
            });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setStreamErrors((current) => {
              const next = new Map(current);
              next.set(
                childSessionId,
                error instanceof Error
                  ? error.message
                  : "The task stream disconnected."
              );
              return next;
            });
          }
        }
      })();

      return controller;
    });

    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, [subscriptionKey]);

  useEffect(() => {
    if (!window.matchMedia("(min-width: 48rem)").matches) return undefined;
    if (!selectedId) {
      const taskId = restoreFocusId.current;
      if (!taskId) return undefined;
      const frame = requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-task-session="${CSS.escape(taskId)}"]`
          )
          ?.focus();
        restoreFocusId.current = undefined;
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    const frame = requestAnimationFrame(() =>
      traceCloseButton.current?.focus()
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedId]);

  const selected = sessions.find(
    (session) => session.childSessionId === selectedId
  );
  const statuses = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.childSessionId,
          getSubagentStatus(
            eventsBySession.get(session.childSessionId) ?? [],
            session
          ),
        ])
      ),
    [eventsBySession, sessions]
  );
  const workingCount = [...statuses.values()].filter((status) =>
    ["starting", "working"].includes(status)
  ).length;
  const doneCount = sessions.length - workingCount;
  const openTask = (sessionId: string) => {
    restoreFocusId.current = sessionId;
    setSelectedId(sessionId);
  };
  const closeTask = () => {
    setSelectedId(undefined);
  };
  const activity = (
    <ActivityCard
      doneCount={doneCount}
      eventsBySession={eventsBySession}
      onSelect={openTask}
      onTraceViewChange={onTraceViewChange}
      sessions={sessions}
      statuses={statuses}
      traceView={traceView}
      usage={usage}
      workingCount={workingCount}
    />
  );

  return (
    <>
      <aside
        aria-hidden={selected !== undefined}
        className={cn(
          "relative hidden h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-linear md:block",
          selected ? "w-0" : "w-112"
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex w-112 items-start p-4 transition-[opacity,transform] duration-200",
            selected
              ? "pointer-events-none translate-x-6 opacity-0"
              : "translate-x-0 opacity-100"
          )}
        >
          {activity}
        </div>
      </aside>

      <Button
        aria-label="Open activity panel"
        className="absolute top-2 right-3 z-30 md:hidden"
        onClick={() => {
          setMobileOpen(true);
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ListTreeIcon />
      </Button>

      <aside
        aria-hidden={!selected}
        className={cn(
          "relative hidden h-full shrink-0 overflow-hidden border-l bg-background transition-[width] duration-200 ease-linear md:block",
          selected ? "w-1/2 min-w-80" : "w-0 border-l-0"
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex w-full min-w-80 flex-col transition-[opacity,transform] duration-200",
            selected
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-6 opacity-0"
          )}
        >
          {selected ? (
            <TracePreview
              events={eventsBySession.get(selected.childSessionId) ?? []}
              closeButtonRef={traceCloseButton}
              onClose={closeTask}
              session={selected}
              status={statuses.get(selected.childSessionId) ?? "starting"}
              streamError={streamErrors.get(selected.childSessionId)}
            />
          ) : null}
        </div>
      </aside>

      <Sheet
        onOpenChange={(open) => {
          setMobileOpen(open);
          if (!open) closeTask();
        }}
        open={mobileOpen}
      >
        <SheetContent
          className="h-[85svh] w-full gap-0 p-0 sm:max-w-none"
          side="bottom"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>
              {selected ? `${selected.name} trace` : "Agent activity"}
            </SheetTitle>
            <SheetDescription>
              {selected
                ? "Full trace for the selected subagent"
                : "Conversation views, sources, and live task statuses"}
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <TracePreview
              events={eventsBySession.get(selected.childSessionId) ?? []}
              onClose={closeTask}
              session={selected}
              status={statuses.get(selected.childSessionId) ?? "starting"}
              streamError={streamErrors.get(selected.childSessionId)}
            />
          ) : (
            activity
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ActivityCard({
  doneCount,
  eventsBySession,
  onSelect,
  onTraceViewChange,
  sessions,
  statuses,
  traceView,
  usage,
  workingCount,
}: {
  readonly doneCount: number;
  readonly eventsBySession: ReadonlyMap<string, readonly MessageStreamEvent[]>;
  readonly onSelect: (sessionId: string) => void;
  readonly onTraceViewChange: (view: "imessage" | "trace") => void;
  readonly sessions: readonly SubagentSession[];
  readonly statuses: ReadonlyMap<string, SubagentStatus>;
  readonly traceView: "imessage" | "trace";
  readonly usage: ChatUsage;
  readonly workingCount: number;
}) {
  return (
    <Card className="max-h-full w-full gap-0 overflow-hidden">
      <CardContent className="min-h-0 overflow-y-auto pr-6">
        <p className="type-card-title text-muted-foreground">Activity</p>
        <Field className="mt-4" orientation="horizontal">
          <FieldLabel htmlFor="show-full-trace">Show full trace</FieldLabel>
          <Switch
            checked={traceView === "trace"}
            id="show-full-trace"
            onCheckedChange={(checked) => {
              onTraceViewChange(checked ? "trace" : "imessage");
            }}
          />
        </Field>
        <div className="type-supporting-body flex items-center p-2 text-muted-foreground">
          <span>Usage</span>
          <span className="ml-auto">{formatChatUsage(usage)}</span>
        </div>

        <section className="mt-5 border-t pt-5">
          <h2 className="type-section-title text-muted-foreground">Tasks</h2>
          {sessions.length === 0 ? (
            <p className="type-supporting-body mt-4 text-muted-foreground">
              No tasks yet
            </p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2 pb-2">
                <Badge variant="information">{workingCount} working</Badge>
                <Badge className="ml-auto" variant="secondary">
                  {doneCount} done
                </Badge>
              </div>
              <div>
                {sessions.map((session) => {
                  const status =
                    statuses.get(session.childSessionId) ?? "starting";
                  const task = getSubagentTask(
                    eventsBySession.get(session.childSessionId) ?? []
                  );
                  return (
                    <Button
                      aria-label={`${agentLabel(session.name)} task, ${status}`}
                      data-task-session={session.childSessionId}
                      key={session.childSessionId}
                      onClick={() => {
                        onSelect(session.childSessionId);
                      }}
                      type="button"
                      variant="surface"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-label">
                          {agentLabel(session.name)}
                        </span>
                        <span className="block truncate type-caption text-muted-foreground">
                          {task ?? "Waiting for assignment"}
                        </span>
                      </span>
                      <StatusIndicator status={status} />
                      <ChevronRightIcon className="text-muted-foreground" />
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function TracePreview({
  closeButtonRef,
  events,
  onClose,
  session,
  status,
  streamError,
}: {
  readonly closeButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly events: readonly MessageStreamEvent[];
  readonly onClose: () => void;
  readonly session: SubagentSession;
  readonly status: SubagentStatus;
  readonly streamError?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate type-card-title">
            {agentLabel(session.name)}
          </h2>
          <p className="truncate type-caption text-muted-foreground">
            Full task trace
          </p>
        </div>
        <Button
          aria-label="Close task trace"
          onClick={onClose}
          ref={closeButtonRef}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
        <SubagentTrace
          events={events}
          status={status}
          streamError={streamError}
          target={session}
        />
      </div>
    </div>
  );
}

function agentLabel(name: string) {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function StatusIndicator({ status }: { readonly status: SubagentStatus }) {
  const variant =
    status === "working" || status === "starting"
      ? "information"
      : status === "failed"
        ? "destructive"
        : status === "cancelled"
          ? "secondary"
          : "success";

  return <Badge variant={variant}>{status}</Badge>;
}

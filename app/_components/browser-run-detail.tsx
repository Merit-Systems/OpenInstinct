"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BrowserRunTable,
  formatCost,
  formatDuration,
  summarizeBrowserRunTasks,
} from "@/app/_components/browser-run-table";
import { useBrowserRunGroups } from "@/app/_components/use-browser-run-groups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  measureBrowserTask,
  readTaskCompletion,
  terminalBrowserMessage,
} from "@/lib/browser-benchmark";
import {
  type BrowserRunGroup,
  type BrowserRunTask,
  type BrowserRunTaskUpdate,
  updateBrowserRunTask,
} from "@/lib/browser-run-store";

const taskTimeoutMs = 15 * 60_000;

export function BrowserRunDetail({ groupId }: { readonly groupId: string }) {
  const router = useRouter();
  const { groups, loaded } = useBrowserRunGroups();
  const group = groups.find((candidate) => candidate.id === groupId);
  const executionStartedRef = useRef(false);
  const clientRef = useRef<Client | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const isActive = group?.tasks.some(
    (task) => task.status === "queued" || task.status === "running"
  );

  useEffect(() => {
    if (!isActive) return;

    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!loaded || !group || executionStartedRef.current) return;

    const pendingTasks = group.tasks.filter(
      (task) => task.status === "queued" || task.status === "running"
    );
    if (pendingTasks.length === 0) return;

    executionStartedRef.current = true;
    const client = clientRef.current ?? new Client({ host: "" });
    clientRef.current = client;
    void runGroup(client, group, pendingTasks);
  }, [group, loaded]);

  if (!loaded) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 type-label">
          <RefreshCwIcon className="size-4 animate-spin" />
          Recovering group…
        </div>
      </main>
    );
  }

  if (!group) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="font-medium text-3xl tracking-tight">
            Group not found
          </h1>
          <p className="mt-2 type-supporting-body text-muted-foreground">
            This group is not saved in this browser.
          </p>
          <Button
            className="mt-5"
            onClick={() => router.push("/")}
            type="button"
            variant="outline"
          >
            <ArrowLeftIcon />
            All tasks
          </Button>
        </div>
      </main>
    );
  }

  const summary = summarizeBrowserRunTasks(group.tasks);
  const wallTimeMs = groupWallTime(group, clock);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button
              onClick={() => router.push("/")}
              size="none"
              type="button"
              variant="quiet"
            >
              <ArrowLeftIcon />
              All tasks
            </Button>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <h1 className="font-medium text-4xl tracking-tight">
                {group.name}
              </h1>
              <Badge variant={isActive ? "information" : "outline"}>
                {isActive ? "running" : "saved"}
              </Badge>
            </div>
            <p className="mt-2 type-supporting-body text-muted-foreground">
              Created {formatGroupTimestamp(group.createdAt)} · concurrency{" "}
              {String(group.concurrency)} · refresh-safe recovery
            </p>
          </div>
          <Button
            onClick={() => window.location.assign("/s")}
            type="button"
            variant="outline"
          >
            Open single task
          </Button>
        </header>

        <section aria-labelledby="group-results-heading" className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="type-card-title" id="group-results-heading">
                Group tasks
              </h2>
              <p className="mt-1 type-supporting-body text-muted-foreground">
                Reloading reconnects running session IDs and rebuilds results
                from their durable event streams.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 type-label">
              <span>
                {String(summary.completed)}/{String(group.tasks.length)}{" "}
                complete
              </span>
              <span className="text-success">
                {String(summary.succeeded)} succeeded
              </span>
              <span>{formatDuration(wallTimeMs)} wall time</span>
              <span>
                {formatCost(summary.costUsd, summary.costComplete)} total
              </span>
            </div>
          </div>

          <BrowserRunTable
            emptyDescription="This group has no tasks."
            emptyTitle="No group tasks"
            groups={[group]}
          />
        </section>
      </div>
    </main>
  );
}

async function runGroup(
  client: Client,
  group: BrowserRunGroup,
  pendingTasks: readonly BrowserRunTask[]
) {
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const task = pendingTasks[nextIndex];
      nextIndex += 1;
      if (!task) return;
      await runPersistedTask(client, group.id, task);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(group.concurrency, pendingTasks.length) },
      async () => worker()
    )
  );
}

async function runPersistedTask(
  client: Client,
  groupId: string,
  task: BrowserRunTask
) {
  const requestStartedAt = task.startedAt ?? Date.now();
  const events: MessageStreamEvent[] = [];
  let timeout: number | undefined;

  const update = (taskUpdate: BrowserRunTaskUpdate) =>
    updateBrowserRunTask(groupId, task.id, taskUpdate);

  try {
    if (task.status === "running" && task.sessionId) {
      const session = client.sessions.attach(task.sessionId, {
        streamIndex: 0,
      });
      for await (const event of session.stream({ startIndex: 0 })) {
        events.push(event);
        projectTaskEvents(events, requestStartedAt, update);
      }
    } else {
      const { response } = await client.sessions.create({
        message: task.prompt,
      });
      update({
        sessionId: response.sessionId,
        startedAt: requestStartedAt,
        status: "running",
      });
      timeout = window.setTimeout(() => {
        update({ terminalMessage: "Timed out after 15 minutes; cancelling…" });
        void response.cancel();
      }, taskTimeoutMs);

      for await (const event of response) {
        events.push(event);
        projectTaskEvents(events, requestStartedAt, update);
      }
    }

    completePersistedTask(events, requestStartedAt, update);
  } catch (error) {
    const completion = readTaskCompletion(events);
    const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
    update({
      completedAt: Date.now(),
      costComplete: metrics.costComplete,
      costUsd: metrics.costUsd,
      durationMs: metrics.durationMs,
      status: completion?.status ?? "failure",
      terminalMessage: completion?.message ?? toErrorMessage(error),
    });
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function projectTaskEvents(
  events: readonly MessageStreamEvent[],
  requestStartedAt: number,
  update: (taskUpdate: BrowserRunTaskUpdate) => void
) {
  const event = events.at(-1);
  if (!event || !shouldProjectEvent(event)) return;

  const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
  const completion = readTaskCompletion(events);
  update({
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    terminalMessage: completion?.message,
  });
}

function completePersistedTask(
  events: readonly MessageStreamEvent[],
  requestStartedAt: number,
  update: (taskUpdate: BrowserRunTaskUpdate) => void
) {
  const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
  const completion = readTaskCompletion(events);
  const fallbackMessage = terminalBrowserMessage(undefined, events);
  update({
    completedAt: Date.now(),
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    status: completion?.status ?? "failure",
    terminalMessage:
      completion?.message ??
      (fallbackMessage === "No terminal message"
        ? "Task ended without calling complete_task."
        : fallbackMessage),
  });
}

function shouldProjectEvent(event: MessageStreamEvent) {
  return (
    event.type === "message.received" ||
    event.type === "actions.requested" ||
    event.type === "action.result" ||
    event.type === "step.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.cancelled" ||
    event.type === "session.failed"
  );
}

function groupWallTime(group: BrowserRunGroup, now: number) {
  const starts = group.tasks.flatMap((task) =>
    task.startedAt === undefined ? [] : [task.startedAt]
  );
  if (starts.length === 0) return 0;

  const start = Math.min(...starts);
  const hasActiveTasks = group.tasks.some(
    (task) => task.status === "queued" || task.status === "running"
  );
  const completions = group.tasks.flatMap((task) =>
    task.completedAt === undefined ? [] : [task.completedAt]
  );
  const end = hasActiveTasks ? now : Math.max(start, ...completions);
  return Math.max(0, end - start);
}

const groupTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatGroupTimestamp(timestamp: string) {
  return groupTimestampFormatter.format(new Date(timestamp));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Task failed.";
}

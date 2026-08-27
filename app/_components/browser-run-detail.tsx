"use client";

import { Client } from "eve/client";
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
import type { BrowserRunGroup, BrowserRunTask } from "@/lib/browser-run-store";
import { runPersistedTask } from "@/lib/browser-task-runner";

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
      <main className="flex min-h-64 items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-2 type-label">
          <RefreshCwIcon className="size-4 animate-spin" />
          Recovering group…
        </div>
      </main>
    );
  }

  if (!group) {
    return (
      <main className="flex min-h-64 items-center justify-center text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-medium tracking-tight">
            Group not found
          </h1>
          <p className="type-supporting-body mt-2 text-muted-foreground">
            This group is not saved in this browser.
          </p>
          <Button
            className="mt-5"
            onClick={() => router.push("/tasks")}
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
    <main className="flex flex-col gap-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            onClick={() => router.push("/tasks")}
            size="none"
            type="button"
            variant="quiet"
          >
            <ArrowLeftIcon />
            All tasks
          </Button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <h1 className="type-page-title">{group.name}</h1>
            <Badge variant={isActive ? "information" : "outline"}>
              {isActive ? "running" : "saved"}
            </Badge>
          </div>
          <p className="type-supporting-body mt-2 text-muted-foreground">
            Created {formatGroupTimestamp(group.createdAt)} · concurrency{" "}
            {String(group.concurrency)} · refresh-safe recovery
          </p>
        </div>
        <Button
          onClick={() => window.location.assign("/chat")}
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
            <p className="type-supporting-body mt-1 text-muted-foreground">
              Reloading reconnects running session IDs and rebuilds results from
              their durable event streams.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 type-label">
            <span>
              {String(summary.completed)}/{String(group.tasks.length)} complete
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

"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRunTable,
  formatCost,
  summarizeBrowserRunTasks,
} from "@/app/_components/browser-run-table";
import { Button } from "@/components/ui/button";
import type { BrowserRunGroup, BrowserRunTask } from "@/lib/browser-run-store";
import {
  taskFromHistoryRun,
  taskHistoryPageSchema,
  type TaskHistoryRun,
} from "@/lib/task-history";

export function GlobalTaskHistory({
  localGroups,
}: {
  readonly localGroups: readonly BrowserRunGroup[];
}) {
  const clientRef = useRef(new Client({ host: "" }));
  const [runs, setRuns] = useState<readonly TaskHistoryRun[]>([]);
  const [tasks, setTasks] = useState<ReadonlyMap<string, BrowserRunTask>>(
    () => new Map()
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const hydrate = useCallback(async (nextRuns: readonly TaskHistoryRun[]) => {
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const run = nextRuns[nextIndex];
        nextIndex += 1;
        if (!run) return;

        const events: MessageStreamEvent[] = [];
        try {
          const session = clientRef.current.sessions.attach(run.sessionId, {
            streamIndex: 0,
          });
          for await (const event of session.stream({
            follow: false,
            startIndex: 0,
          })) {
            events.push(event);
          }
        } catch {
          // The durable index remains useful if an old event stream is unavailable.
        }

        const task = taskFromHistoryRun(run, events);
        setTasks((current) => {
          const next = new Map(current);
          next.set(run.sessionId, task);
          return next;
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(6, nextRuns.length) }, worker)
    );
  }, []);

  const loadPage = useCallback(
    async (pageCursor?: string, replace = false) => {
      setLoading(true);
      setError(undefined);
      try {
        const search = pageCursor
          ? `?cursor=${encodeURIComponent(pageCursor)}`
          : "";
        const response = await fetch(`/api/tasks${search}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Task history request failed");
        const page = taskHistoryPageSchema.parse(await response.json());

        setRuns((current) => {
          const combined = replace ? page.runs : [...current, ...page.runs];
          return [
            ...new Map(combined.map((run) => [run.sessionId, run])).values(),
          ];
        });
        setCursor(page.cursor);
        setHasMore(page.hasMore);
        await hydrate(page.runs);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load task history"
        );
      } finally {
        setLoading(false);
      }
    },
    [hydrate]
  );

  useEffect(() => {
    void loadPage(undefined, true);
  }, [loadPage]);

  const tableGroups = useMemo(
    () => historyTableGroups(runs, tasks, localGroups),
    [localGroups, runs, tasks]
  );
  const visibleTasks = tableGroups.flatMap((group) => group.tasks);
  const summary = summarizeBrowserRunTasks(visibleTasks);

  return (
    <section aria-labelledby="all-tasks-heading" className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="type-card-title" id="all-tasks-heading">
            Every task ever run
          </h2>
          <p className="mt-1 type-supporting-body text-muted-foreground">
            Durable project-wide history across browsers and sessions. Load
            older pages to walk the complete run ledger.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 type-label">
          {visibleTasks.length > 0 ? (
            <>
              <span>{String(visibleTasks.length)} loaded</span>
              <span className="text-success">
                {String(summary.succeeded)} succeeded
              </span>
              <span>
                {formatCost(summary.costUsd, summary.costComplete)} total
              </span>
            </>
          ) : null}
          <Button
            disabled={loading}
            onClick={() => void loadPage(undefined, true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <p className="type-supporting-body text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <BrowserRunTable
        emptyDescription={
          loading
            ? "Reading the durable workflow ledger…"
            : "Create a group above to start the first task."
        }
        emptyTitle={loading ? "Loading task history" : "No tasks yet"}
        groups={tableGroups}
        showGroup
      />

      {hasMore && cursor ? (
        <Button
          className="justify-self-center"
          disabled={loading}
          onClick={() => void loadPage(cursor)}
          type="button"
          variant="outline"
        >
          {loading ? "Loading…" : "Load older tasks"}
        </Button>
      ) : null}
    </section>
  );
}

function historyTableGroups(
  runs: readonly TaskHistoryRun[],
  historyTasks: ReadonlyMap<string, BrowserRunTask>,
  localGroups: readonly BrowserRunGroup[]
) {
  const localBySession = new Map(
    localGroups.flatMap((group) =>
      group.tasks.flatMap((task) =>
        task.sessionId ? [[task.sessionId, { group, task }] as const] : []
      )
    )
  );
  const rows = runs.map((run) => {
    const local = localBySession.get(run.sessionId);
    const task =
      historyTasks.get(run.sessionId) ?? local?.task ?? indexedTask(run);
    return { group: local?.group, task };
  });
  const indexedSessions = new Set(runs.map((run) => run.sessionId));

  for (const group of localGroups) {
    for (const task of group.tasks) {
      if (task.sessionId && indexedSessions.has(task.sessionId)) continue;
      rows.push({ group, task });
    }
  }

  return rows
    .toSorted(
      (left, right) =>
        taskSortTime(right.task, right.group) -
        taskSortTime(left.task, left.group)
    )
    .map(({ group, task }) => ({
      concurrency: group?.concurrency ?? 1,
      createdAt:
        group?.createdAt ?? new Date(task.startedAt ?? 0).toISOString(),
      id: group?.id ?? "",
      name: group?.name ?? "Single task",
      tasks: [task],
      updatedAt: group?.updatedAt ?? new Date().toISOString(),
    }));
}

function indexedTask(run: TaskHistoryRun): BrowserRunTask {
  const startedAt = new Date(run.createdAt).getTime();
  return {
    costComplete: false,
    costUsd: null,
    durationMs: Math.max(0, new Date(run.updatedAt).getTime() - startedAt),
    id: run.sessionId,
    prompt: run.prompt,
    sessionId: run.sessionId,
    startedAt,
    status: run.status === "pending" ? "queued" : "running",
  };
}

function taskSortTime(
  task: BrowserRunTask,
  group: BrowserRunGroup | undefined
) {
  return task.startedAt ?? new Date(group?.createdAt ?? 0).getTime();
}

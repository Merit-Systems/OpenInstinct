"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRunTable,
  formatCost,
  summarizeBrowserRunTasks,
} from "@/app/(authenticated)/(tasks)/_components/browser-run-table";
import { Button } from "@/components/ui/button";
import type { BrowserRunTask } from "@/app/(authenticated)/_lib/browser-run-store";
import {
  historyTableGroups,
  taskFromHistoryRun,
} from "@/app/(authenticated)/(tasks)/_lib/task-history";
import type {
  TaskHistoryPage,
  TaskHistoryRun,
} from "@/app/(authenticated)/(tasks)/_lib/task-history";
import { api } from "@/trpc/client";
import { useBrowserRunGroups } from "@/app/(authenticated)/(tasks)/_components/use-browser-run-groups";

export function GlobalTaskHistory({
  initialError,
  initialPage,
}: {
  readonly initialError?: string;
  readonly initialPage?: TaskHistoryPage;
}) {
  const { groups: localGroups } = useBrowserRunGroups();
  const clientRef = useRef(new Client({ host: "" }));
  const hydratedSessions = useRef(new Set<string>());
  const [tasks, setTasks] = useState<ReadonlyMap<string, BrowserRunTask>>(
    () => new Map()
  );
  const history = api.tasks.list.useInfiniteQuery(
    {},
    {
      getNextPageParam: (page) =>
        page.hasMore ? (page.cursor ?? undefined) : undefined,
      initialData: initialPage
        ? { pageParams: [null], pages: [initialPage] }
        : undefined,
      initialCursor: null,
      staleTime: 30 * 1000,
    }
  );
  const pages = history.data?.pages;
  const runs = useMemo(
    () => [
      ...new Map(
        (pages ?? [])
          .flatMap((page) => page.runs)
          .map((run) => [run.sessionId, run])
      ).values(),
    ],
    [pages]
  );
  const historyError = history.error
    ? history.error instanceof Error
      ? history.error.message
      : "Unable to load task history"
    : history.data
      ? undefined
      : initialError;

  const hydrate = useCallback(async (nextRuns: readonly TaskHistoryRun[]) => {
    const pendingRuns = nextRuns.filter((run) => {
      if (hydratedSessions.current.has(run.sessionId)) return false;
      hydratedSessions.current.add(run.sessionId);
      return true;
    });
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const run = pendingRuns[nextIndex];
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
      Array.from({ length: Math.min(6, pendingRuns.length) }, worker)
    );
  }, []);

  useEffect(() => {
    void hydrate(runs);
  }, [hydrate, runs]);

  const refresh = async () => {
    const result = await history.refetch();
    if (!result.data) return;
    hydratedSessions.current.clear();
    setTasks(new Map());
    await hydrate(result.data.pages.flatMap((page) => page.runs));
  };

  const tableGroups = useMemo(
    () => historyTableGroups(runs, tasks, localGroups),
    [localGroups, runs, tasks]
  );
  const visibleTasks = tableGroups.map(({ task }) => task);
  const summary = summarizeBrowserRunTasks(visibleTasks);

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 type-label">
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
          disabled={history.isFetching}
          onClick={() => void refresh()}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon
            className={history.isFetching ? "animate-spin" : undefined}
          />
          Refresh
        </Button>
      </div>

      {historyError ? (
        <p className="type-supporting-body text-destructive" role="alert">
          {historyError}
        </p>
      ) : null}

      <BrowserRunTable
        emptyDescription={
          history.isFetching && runs.length === 0
            ? "Reading the durable workflow ledger…"
            : "Create a group above to start the first task."
        }
        emptyTitle={
          history.isFetching && runs.length === 0
            ? "Loading task history"
            : "No tasks yet"
        }
        rows={tableGroups}
        showGroup
      />

      {history.hasNextPage ? (
        <Button
          className="justify-self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
          type="button"
          variant="outline"
        >
          {history.isFetchingNextPage ? "Loading…" : "Load older tasks"}
        </Button>
      ) : null}
    </>
  );
}

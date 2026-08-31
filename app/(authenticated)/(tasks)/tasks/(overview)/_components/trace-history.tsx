"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrowserTracePage } from "@/db/services/browser-traces";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/client";

const statusLabels = {
  cancelled: { className: "text-muted-foreground", label: "Cancelled" },
  error: { className: "text-destructive", label: "Error" },
  failure: { className: "text-warning", label: "Failed" },
  running: { className: "text-information", label: "Running" },
  success: { className: "text-success", label: "Succeeded" },
} as const;

function statusLabel(status: string) {
  return status in statusLabels
    ? statusLabels[status as keyof typeof statusLabels]
    : ({ className: "text-muted-foreground", label: status } as const);
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return "<1s";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export function TraceHistory({
  initialError,
  initialPage,
}: {
  readonly initialError?: string;
  readonly initialPage?: BrowserTracePage;
}) {
  const router = useRouter();
  const history = api.traces.list.useInfiniteQuery(
    {},
    {
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialData: initialPage
        ? { pageParams: [null], pages: [initialPage] }
        : undefined,
      initialCursor: null,
      staleTime: 30 * 1000,
    }
  );
  const pages = history.data?.pages;
  const traces = useMemo(
    () => [
      ...new Map(
        (pages ?? [])
          .flatMap((page) => page.traces)
          .map((trace) => [trace.sessionId, trace])
      ).values(),
    ],
    [pages]
  );
  const historyError = history.error
    ? history.error instanceof Error
      ? history.error.message
      : "Unable to load browser traces"
    : history.data
      ? undefined
      : initialError;
  const succeeded = traces.filter((trace) => trace.status === "success").length;

  return (
    <section aria-label="Browser trace history" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 type-label">
        {traces.length > 0 ? (
          <>
            <span>{String(traces.length)} loaded</span>
            <span className="text-success">{String(succeeded)} succeeded</span>
          </>
        ) : null}
        <Button
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
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

      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[26%]">Task</TableHead>
            <TableHead className="w-[9%]">Status</TableHead>
            <TableHead className="w-[8%]">Duration</TableHead>
            <TableHead className="w-[18%]">Domains</TableHead>
            <TableHead className="w-[25%]">Result</TableHead>
            <TableHead className="w-[14%]">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} variant="empty">
                {history.isFetching
                  ? "Loading browser traces…"
                  : "No browser traces yet. Give the agent a browser task from the chat."}
              </TableCell>
            </TableRow>
          ) : (
            traces.map((trace) => {
              const status = statusLabel(trace.status);
              return (
                <TableRow
                  className="cursor-pointer hover:bg-muted/50"
                  key={trace.sessionId}
                  onClick={() => {
                    router.push(`/tasks/${trace.sessionId}`);
                  }}
                >
                  <TableCell className="truncate" title={trace.task}>
                    {trace.task}
                  </TableCell>
                  <TableCell className={cn("truncate", status.className)}>
                    {status.label}
                  </TableCell>
                  <TableCell className="truncate">
                    {formatDuration(trace.durationMs)}
                  </TableCell>
                  <TableCell
                    className="truncate"
                    title={trace.domains.join(", ")}
                  >
                    {trace.domains.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      trace.domains.join(", ")
                    )}
                  </TableCell>
                  <TableCell
                    className="truncate text-muted-foreground"
                    title={trace.resultMessage ?? undefined}
                  >
                    {trace.resultMessage ?? "—"}
                  </TableCell>
                  <TableCell
                    className="truncate text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {new Date(trace.startedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {history.hasNextPage ? (
        <Button
          className="justify-self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
          type="button"
          variant="outline"
        >
          {history.isFetchingNextPage ? "Loading…" : "Load older traces"}
        </Button>
      ) : null}
    </section>
  );
}

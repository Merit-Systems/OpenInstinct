"use client";

import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrowserRunGroup, BrowserRunTask } from "@/lib/browser-run-store";

export function BrowserRunTable({
  emptyDescription,
  emptyTitle,
  groups,
  showGroup = false,
}: {
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly groups: readonly BrowserRunGroup[];
  readonly showGroup?: boolean;
}) {
  const router = useRouter();
  const rows = groups.flatMap((group) =>
    group.tasks.map((task) => ({ group, task }))
  );
  const hasRunningTasks = rows.some(({ task }) => task.status === "running");
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!hasRunningTasks) return;

    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [hasRunningTasks]);

  return (
    <Card>
      {rows.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center px-6 text-center text-muted-foreground">
          <div>
            <PlayIcon className="mx-auto mb-3 size-5" />
            <p className="type-label">{emptyTitle}</p>
            <p className="mt-1 type-supporting-body">{emptyDescription}</p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {showGroup ? <TableHead className="pl-4">Group</TableHead> : null}
              <TableHead className={showGroup ? undefined : "pl-4"}>
                Task
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Run at</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>LLM cost</TableHead>
              <TableHead className="w-[38%] pr-4">Terminal message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ group, task }, index) => (
              <TableRow key={task.id}>
                {showGroup ? (
                  <TableCell className="max-w-48 pl-4 whitespace-normal">
                    {group.id ? (
                      <Button
                        className="text-left whitespace-normal"
                        onClick={() => router.push(`/runs/${group.id}`)}
                        size="none"
                        type="button"
                        variant="quiet"
                      >
                        {group.name}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">
                        {group.name}
                      </span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell
                  className={`max-w-md whitespace-normal ${showGroup ? "" : "pl-4"}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 type-caption text-muted-foreground tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{task.prompt}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <TaskStatusBadge status={task.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatTaskTimestamp(task.startedAt)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatTaskDuration(task, clock)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatCost(task.costUsd, task.costComplete)}
                </TableCell>
                <TableCell className="max-w-lg pr-4 whitespace-normal">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {task.terminalMessage ??
                        (task.status === "running" ? "Running…" : "—")}
                    </span>
                    {task.sessionId ? (
                      <Button
                        aria-label="Open task session"
                        onClick={() =>
                          window.open(
                            `/chat/${encodeURIComponent(task.sessionId ?? "")}`,
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                        size="icon-xs"
                        type="button"
                        variant="quiet"
                      >
                        <ExternalLinkIcon />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function summarizeBrowserRunTasks(tasks: readonly BrowserRunTask[]) {
  const measuredCosts = tasks.flatMap((task) =>
    task.costUsd === null ? [] : [task.costUsd]
  );

  return {
    completed: tasks.filter(
      (task) => task.status === "success" || task.status === "failure"
    ).length,
    costComplete: tasks.length > 0 && tasks.every((task) => task.costComplete),
    costUsd:
      measuredCosts.length === 0
        ? null
        : measuredCosts.reduce((total, cost) => total + cost, 0),
    succeeded: tasks.filter((task) => task.status === "success").length,
  };
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${String(Math.max(0, milliseconds))}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

export function formatCost(costUsd: number | null, complete: boolean) {
  if (costUsd === null) return "—";
  return `${complete ? "" : "~"}$${costUsd.toFixed(6)}`;
}

function TaskStatusBadge({
  status,
}: {
  readonly status: BrowserRunTask["status"];
}) {
  const variants = {
    failure: "destructive",
    queued: "secondary",
    running: "information",
    success: "success",
  } as const;

  return (
    <Badge variant={variants[status]}>
      {status === "running" ? <Spinner className="size-3" /> : null}
      {status}
    </Badge>
  );
}

function formatTaskDuration(task: BrowserRunTask, now: number) {
  if (task.status === "queued") return "—";
  if (task.status === "running" && task.startedAt) {
    return formatDuration(now - task.startedAt);
  }
  return formatDuration(task.durationMs);
}

const taskTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTaskTimestamp(timestamp: number | undefined) {
  return timestamp === undefined
    ? "—"
    : taskTimestampFormatter.format(new Date(timestamp));
}

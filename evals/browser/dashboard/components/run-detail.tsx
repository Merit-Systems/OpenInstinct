"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BrowserBenchmarkLiveStatus } from "../../live-status-schema";
import { useRuns } from "../lib/use-runs";

type Variant = BrowserBenchmarkLiveStatus["variants"]["baseline"];
type Task = Variant["tasks"][number];

export function RunDetail({ runId }: { runId: string }) {
  const { error, runs } = useRuns();
  const [now, setNow] = useState(() => Date.now());
  const run = runs.find((candidate) => candidate.runId === runId) ?? null;
  const active = run?.status === "preparing" || run?.status === "running";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Link
            className="type-caption text-muted-foreground hover:text-foreground"
            href="/"
          >
            ← All runs
          </Link>
          <h1 className="type-page-title mt-3">
            {run?.label ?? "Browser A/B"}
          </h1>
          {run ? (
            <p className="type-supporting-body mt-1 text-muted-foreground">
              {run.suite} · {run.variants.baseline.sha.slice(0, 7)} →{" "}
              {run.variants.candidate.sha.slice(0, 7)}
            </p>
          ) : null}
        </div>
        {run ? <StatusText status={run.status} /> : null}
      </header>

      {error ? (
        <p className="type-supporting-body text-destructive">{error}</p>
      ) : null}
      {run?.error ? (
        <p className="type-supporting-body text-destructive">{run.error}</p>
      ) : null}
      {run ? (
        <RunTables now={now} run={run} />
      ) : (
        <p className="type-supporting-body text-muted-foreground">
          Loading run…
        </p>
      )}
    </main>
  );
}

function RunTables({
  now,
  run,
}: {
  now: number;
  run: BrowserBenchmarkLiveStatus;
}) {
  const baseline = run.variants.baseline.tasks;
  const candidate = run.variants.candidate.tasks;
  const tasks = [
    ...baseline.map((task) => task.id),
    ...candidate
      .filter(
        (task) => !baseline.some((baselineTask) => baselineTask.id === task.id)
      )
      .map((task) => task.id),
  ];
  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 type-caption text-muted-foreground">
        <span>Concurrency {run.maxConcurrency}</span>
        <span>Task budget {formatDuration(run.taskTimeoutMs)}</span>
        <span>
          Wall {formatDuration(elapsed(run.startedAt, run.completedAt, now))}
        </span>
        <code>{run.runId}</code>
      </div>

      <div className="overflow-hidden border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Revision</TableHead>
              <TableHead>Passed</TableHead>
              <TableHead>Running</TableHead>
              <TableHead>Failed</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <VariantRow variant={run.variants.baseline} />
            <VariantRow variant={run.variants.candidate} />
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="type-section-title mb-3">Tasks</h2>
        <div className="overflow-hidden border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24%]">Task</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Candidate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} variant="empty">
                    Preparing evaluations…
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((taskId) => {
                  const left = baseline.find((task) => task.id === taskId);
                  const right = candidate.find((task) => task.id === taskId);
                  return (
                    <TableRow key={taskId}>
                      <TableCell className="align-top font-medium whitespace-normal">
                        {left?.name ?? right?.name ?? "Task"}
                      </TableCell>
                      <TaskResultCell now={now} task={left} />
                      <TaskResultCell now={now} task={right} />
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="type-caption text-muted-foreground">
        Artifacts: <code>{run.outputDirectory}</code>
      </p>
    </>
  );
}

function VariantRow({ variant }: { variant: Variant }) {
  const summary = summarize(variant);
  return (
    <TableRow>
      <TableCell className="font-medium capitalize">{variant.kind}</TableCell>
      <TableCell>
        <StatusText status={variant.status} />
      </TableCell>
      <TableCell variant="code">
        {variant.ref} · {variant.sha.slice(0, 12)}
      </TableCell>
      <TableCell>
        {summary.passed}/{variant.tasks.length}
      </TableCell>
      <TableCell>{summary.running}</TableCell>
      <TableCell>{summary.failed}</TableCell>
      <TableCell>{formatCost(summary.cost, summary.costComplete)}</TableCell>
    </TableRow>
  );
}

function TaskResultCell({ now, task }: { now: number; task?: Task }) {
  if (!task)
    return <TableCell className="text-muted-foreground">Waiting</TableCell>;
  const message =
    task.terminalMessage ??
    task.error ??
    (task.status === "running" ? "Working…" : "—");
  const sessions = task.sessions
    .map((session) => `${session.role} ${session.id.slice(0, 8)}`)
    .join(", ");
  const tools = Object.entries(task.toolCalls)
    .map(([name, count]) => `${name} ×${String(count)}`)
    .join(", ");
  return (
    <TableCell className="max-w-0 align-top whitespace-normal">
      <div className="flex items-center gap-2">
        <StatusText status={task.status} />
        <span className="type-caption text-muted-foreground">
          {formatDuration(
            task.durationMs ?? elapsed(task.startedAt, task.completedAt, now)
          )}{" "}
          · {formatCost(task.costUsd, task.costComplete)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 type-caption" title={message}>
        {message}
      </p>
      {sessions || tools ? (
        <p
          className="type-compact-code mt-1 truncate text-muted-foreground"
          title={[sessions, tools].filter(Boolean).join(" · ")}
        >
          {[sessions, tools].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </TableCell>
  );
}

function StatusText({ status }: { status: string }) {
  let className = "text-muted-foreground";
  if (status === "passed" || status === "completed") className = "text-success";
  if (status === "failed") className = "text-destructive";
  if (status === "scored" || status === "skipped") className = "text-warning";
  if (status === "running" || status === "preparing")
    className = "text-information";
  return <span className={className}>{status}</span>;
}

function summarize(variant: Variant) {
  let passed = 0;
  let running = 0;
  let failed = 0;
  let cost = 0;
  for (const task of variant.tasks) {
    if (task.success === true) passed += 1;
    if (task.status === "running") running += 1;
    if (task.success === false) failed += 1;
    cost += task.costUsd ?? 0;
  }
  return {
    cost,
    costComplete:
      variant.tasks.length > 0 &&
      variant.tasks.every((task) => task.costComplete),
    failed,
    passed,
    running,
  };
}

function elapsed(
  startedAt: string | null,
  completedAt: string | null,
  now: number
) {
  if (!startedAt) return null;
  return Math.max(
    0,
    (completedAt ? new Date(completedAt).getTime() : now) -
      new Date(startedAt).getTime()
  );
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  if (milliseconds < 1_000) return `${String(Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(Math.floor(seconds % 60))}s`;
}

function formatCost(cost: number | null, complete: boolean) {
  if (cost === null) return "—";
  return `${complete ? "" : "~"}$${cost.toFixed(4)}`;
}

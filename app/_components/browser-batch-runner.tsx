"use client";

import { Client, type MessageStreamEvent } from "eve/client";
import {
  ExternalLinkIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { browserBenchmarkTasks } from "@/lib/browser-benchmark-tasks";
import {
  measureBrowserTask,
  readTaskCompletion,
  terminalBrowserMessage,
} from "@/lib/browser-benchmark";

const taskTimeoutMs = 180_000;
const starterTasks = browserBenchmarkTasks
  .map((task) => task.prompt)
  .join("\n");

type BatchTaskStatus = "queued" | "running" | "success" | "failure";

type BatchTask = {
  readonly costComplete: boolean;
  readonly costUsd: number | null;
  readonly durationMs: number;
  readonly id: string;
  readonly prompt: string;
  readonly sessionId?: string;
  readonly startedAt?: number;
  readonly status: BatchTaskStatus;
  readonly terminalMessage?: string;
};

type TaskUpdate = Partial<Omit<BatchTask, "id" | "prompt">>;

export function BrowserBatchRunner() {
  const [input, setInput] = useState(starterTasks);
  const [concurrency, setConcurrency] = useState(4);
  const [tasks, setTasks] = useState<readonly BatchTask[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number>();
  const [runCompletedAt, setRunCompletedAt] = useState<number>();
  const [clock, setClock] = useState(() => Date.now());
  const [isStopping, setIsStopping] = useState(false);
  const clientRef = useRef<Client | null>(null);
  const stopRequestedRef = useRef(false);
  const cancellationsRef = useRef(new Map<string, () => Promise<void>>());

  const parsedTasks = useMemo(() => parseTasks(input), [input]);
  const isActive = tasks.some(
    (task) => task.status === "queued" || task.status === "running"
  );

  useEffect(() => {
    if (!isActive) return;

    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isActive]);

  const summary = summarizeTasks(tasks);
  const runDurationMs = runStartedAt
    ? (runCompletedAt ?? clock) - runStartedAt
    : 0;

  const updateTask = (id: string, update: TaskUpdate) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...update } : task))
    );
  };

  const runBatch = async (batch: readonly BatchTask[]) => {
    const client = clientRef.current ?? new Client({ host: "" });
    clientRef.current = client;
    let nextIndex = 0;

    const worker = async () => {
      while (!stopRequestedRef.current) {
        const task = batch[nextIndex];
        nextIndex += 1;
        if (!task) return;

        await runBrowserTask({
          client,
          registerCancellation(cancel) {
            cancellationsRef.current.set(task.id, cancel);
          },
          task,
          unregisterCancellation() {
            cancellationsRef.current.delete(task.id);
          },
          update: (update) => updateTask(task.id, update),
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, batch.length) }, async () =>
        worker()
      )
    );
    setRunCompletedAt(Date.now());
  };

  const handleRun = () => {
    if (parsedTasks.length === 0 || isActive) return;

    stopRequestedRef.current = false;
    cancellationsRef.current.clear();
    const startedAt = Date.now();
    const batch = parsedTasks.map((prompt) => ({
      costComplete: false,
      costUsd: null,
      durationMs: 0,
      id: crypto.randomUUID(),
      prompt,
      status: "queued" as const,
    }));

    setClock(startedAt);
    setRunStartedAt(startedAt);
    setRunCompletedAt(undefined);
    setTasks(batch);
    void runBatch(batch);
  };

  const handleStop = async () => {
    stopRequestedRef.current = true;
    setIsStopping(true);
    setTasks((current) =>
      current.map((task) =>
        task.status === "queued"
          ? {
              ...task,
              status: "failure",
              terminalMessage: "Cancelled before starting.",
            }
          : task
      )
    );

    await Promise.allSettled(
      [...cancellationsRef.current.values()].map(async (cancel) => cancel())
    );
    setIsStopping(false);
  };

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="type-label text-primary">eve-kernel</p>
            <h1 className="mt-1 font-medium text-4xl tracking-tight">
              Browser batch runner
            </h1>
            <p className="mt-2 type-supporting-body text-muted-foreground">
              Run independent browser jobs concurrently and compare completion,
              latency, and model cost from the live agent event stream.
            </p>
          </div>
          <Button
            onClick={() => window.location.assign("/s")}
            type="button"
            variant="outline"
          >
            Open single task
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>
              Enter one browser task per line. Each task gets its own agent
              session and browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="batch-tasks">Task list</Label>
              <Textarea
                className="min-h-48 resize-y"
                disabled={isActive}
                id="batch-tasks"
                onChange={(event) => setInput(event.target.value)}
                placeholder="Get me tickets to Spider-Man tonight…"
                value={input}
              />
              <p className="type-caption text-muted-foreground">
                {parsedTasks.length === 1
                  ? "1 task ready"
                  : `${String(parsedTasks.length)} tasks ready`}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-2">
                <Label htmlFor="batch-concurrency">Concurrency</Label>
                <Select
                  disabled={isActive}
                  onValueChange={(value) => setConcurrency(Number(value))}
                  value={String(concurrency)}
                >
                  <SelectTrigger id="batch-concurrency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 8].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {String(value)} at once
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isActive ? (
                <Button
                  disabled={isStopping}
                  onClick={() => void handleStop()}
                  type="button"
                  variant="destructive"
                >
                  {isStopping ? <Spinner /> : <SquareIcon />}
                  Stop all
                </Button>
              ) : (
                <Button
                  disabled={parsedTasks.length === 0}
                  onClick={handleRun}
                  type="button"
                >
                  <PlayIcon />
                  Run {String(parsedTasks.length)} tasks
                </Button>
              )}

              <Button
                disabled={isActive}
                onClick={() => setInput(starterTasks)}
                type="button"
                variant="ghost"
              >
                <RotateCcwIcon />
                Load examples
              </Button>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="results-heading" className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="type-card-title" id="results-heading">
                Results
              </h2>
              <p className="mt-1 type-supporting-body text-muted-foreground">
                Time ends when complete_task settles. Cost sums LLM usage for
                the full turn.
              </p>
            </div>
            {tasks.length > 0 ? (
              <div className="flex flex-wrap gap-x-5 gap-y-1 type-label">
                <span>
                  {String(summary.completed)}/{String(tasks.length)} complete
                </span>
                <span className="text-success">
                  {String(summary.succeeded)} succeeded
                </span>
                <span>{formatDuration(runDurationMs)} wall time</span>
                <span>
                  {formatCost(summary.costUsd, summary.costComplete)} total
                </span>
              </div>
            ) : null}
          </div>

          <Card>
            {tasks.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center px-6 text-center text-muted-foreground">
                <div>
                  <PlayIcon className="mx-auto mb-3 size-5" />
                  <p className="type-label">No run yet</p>
                  <p className="mt-1 type-supporting-body">
                    Start the example batch or replace it with your own tasks.
                  </p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[38%] pl-4">Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>LLM cost</TableHead>
                    <TableHead className="w-[42%] pr-4">
                      Terminal message
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task, index) => (
                    <TableRow key={task.id}>
                      <TableCell className="max-w-md pl-4 whitespace-normal">
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
                                  `/s/${encodeURIComponent(task.sessionId ?? "")}`,
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
        </section>
      </div>
    </main>
  );
}

async function runBrowserTask({
  client,
  registerCancellation,
  task,
  unregisterCancellation,
  update,
}: {
  readonly client: Client;
  readonly registerCancellation: (cancel: () => Promise<void>) => void;
  readonly task: BatchTask;
  readonly unregisterCancellation: () => void;
  readonly update: (update: TaskUpdate) => void;
}) {
  const requestStartedAt = Date.now();
  const events: MessageStreamEvent[] = [];
  let cancellationMessage: string | undefined;
  let timeout: number | undefined;

  update({ durationMs: 0, startedAt: requestStartedAt, status: "running" });

  try {
    const { response } = await client.sessions.create({ message: task.prompt });
    let cancellation: Promise<void> | undefined;
    const cancel = (message: string) => {
      cancellationMessage = message;
      update({ terminalMessage: message });
      cancellation ??= response.cancel().then(() => undefined);
      return cancellation;
    };

    registerCancellation(() => cancel("Cancelling…"));
    update({ sessionId: response.sessionId });
    timeout = window.setTimeout(() => {
      void cancel("Timed out after 3 minutes; cancelling…");
    }, taskTimeoutMs);

    for await (const event of response) {
      events.push(event);
      if (!shouldProjectEvent(event)) continue;

      const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
      const completion = readTaskCompletion(events);
      update({
        costComplete: metrics.costComplete,
        costUsd: metrics.costUsd,
        durationMs: metrics.durationMs,
        terminalMessage: completion?.message ?? cancellationMessage,
      });
    }

    const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
    const completion = readTaskCompletion(events);
    const fallbackMessage = terminalBrowserMessage(undefined, events);
    update({
      costComplete: metrics.costComplete,
      costUsd: metrics.costUsd,
      durationMs: metrics.durationMs,
      status: completion?.status ?? "failure",
      terminalMessage:
        completion?.message ??
        cancellationMessage ??
        (fallbackMessage === "No terminal message"
          ? "Task ended without calling complete_task."
          : fallbackMessage),
    });
  } catch (error) {
    const completion = readTaskCompletion(events);
    const metrics = measureBrowserTask(events, Date.now() - requestStartedAt);
    update({
      costComplete: metrics.costComplete,
      costUsd: metrics.costUsd,
      durationMs: metrics.durationMs,
      status: completion?.status ?? "failure",
      terminalMessage:
        completion?.message ?? cancellationMessage ?? toErrorMessage(error),
    });
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    unregisterCancellation();
  }
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

function parseTasks(input: string) {
  return input
    .split("\n")
    .map((task) => task.trim())
    .filter((task) => task.length > 0);
}

function summarizeTasks(tasks: readonly BatchTask[]) {
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

function TaskStatusBadge({ status }: { readonly status: BatchTaskStatus }) {
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

function formatTaskDuration(task: BatchTask, now: number) {
  if (task.status === "queued") return "—";
  if (task.status === "running" && task.startedAt) {
    return formatDuration(now - task.startedAt);
  }
  return formatDuration(task.durationMs);
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${String(Math.max(0, milliseconds))}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatCost(costUsd: number | null, complete: boolean) {
  if (costUsd === null) return "—";
  return `${complete ? "" : "~"}$${costUsd.toFixed(6)}`;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Task failed.";
}

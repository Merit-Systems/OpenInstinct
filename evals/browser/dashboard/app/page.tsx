"use client";

/* oxlint-disable tailwindcss/no-unknown-classes -- this standalone dashboard owns a small plain-CSS theme */

import { useEffect, useState } from "react";
import {
  browserBenchmarkLiveStatusSchema,
  type BrowserBenchmarkLiveStatus,
} from "../../live-status-schema";

type Variant = BrowserBenchmarkLiveStatus["variants"]["baseline"];
type Task = Variant["tasks"][number];

export default function BrowserBenchmarkDashboard() {
  const [status, setStatus] = useState<BrowserBenchmarkLiveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      let nextDelay = 5_000;
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 204) {
          setStatus(null);
          setError(null);
        } else if (response.ok) {
          const next = browserBenchmarkLiveStatusSchema.parse(
            await response.json()
          );
          setStatus(next);
          setError(null);
          if (next.status === "preparing" || next.status === "running") {
            nextDelay = 1_000;
          }
        } else {
          setError("Unable to read live benchmark status.");
        }
      } catch {
        if (!cancelled) setError("Dashboard server is unreachable.");
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          void poll();
        }, nextDelay);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const active = status?.status === "preparing" || status?.status === "running";
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
    <main>
      <header>
        <div>
          <p className="eyebrow">Local evaluation tooling</p>
          <h1>Browser A/B</h1>
          <p className="subhead">
            Live, intent-level comparison across isolated revisions. This view
            observes status only; the terminal that starts a run owns it.
          </p>
        </div>
        <div className="live" aria-live="polite">
          <span className={`dot ${active ? "active" : ""}`} />
          {status ? (
            <>
              {status.status} · updated {formatTime(status.updatedAt)}
            </>
          ) : (
            "No run published"
          )}
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {status?.error ? <div className="error">{status.error}</div> : null}

      {status ? <Run status={status} now={now} /> : <EmptyState />}
    </main>
  );
}

function Run({
  status,
  now,
}: {
  status: BrowserBenchmarkLiveStatus;
  now: number;
}) {
  const baseline = status.variants.baseline.tasks;
  const candidate = status.variants.candidate.tasks;
  const taskCount = Math.max(baseline.length, candidate.length);

  return (
    <>
      <div className="meta">
        <span>
          Suite <strong>{status.suite}</strong>
        </span>
        <span>
          Repetitions <strong>{status.repetitions}</strong>
        </span>
        <span>
          Task concurrency <strong>{status.maxConcurrency}</strong>
        </span>
        <span>
          Task budget <strong>{formatDuration(status.taskTimeoutMs)}</strong>
        </span>
        <span>
          Wall time{" "}
          <strong>
            {formatDuration(elapsed(status.startedAt, status.completedAt, now))}
          </strong>
        </span>
        <code>Run {status.runId}</code>
      </div>

      <section className="variants" aria-label="Revision summaries">
        <VariantCard variant={status.variants.baseline} />
        <VariantCard variant={status.variants.candidate} />
      </section>

      <div className="section-head">
        <div>
          <p className="eyebrow">Task-by-task</p>
          <h2>Execution ledger</h2>
        </div>
        <p>Agent time · LLM cost · sessions · tool calls · judged outcome</p>
      </div>

      {taskCount === 0 ? (
        <section className="empty compact">
          <h2>Preparing the evaluations</h2>
          <p>
            Tasks appear when Eve schedules the suite. Revision setup can take a
            minute.
          </p>
        </section>
      ) : (
        <section className="ledger" aria-label="Benchmark task comparison">
          <div className="column-heads" aria-hidden="true">
            <span>Intent</span>
            <span>Baseline</span>
            <span>Candidate</span>
          </div>
          {Array.from({ length: taskCount }, (_, index) => {
            const left = baseline[index];
            const right = candidate[index];
            return (
              <article
                className="task-row"
                key={left?.id ?? right?.id ?? index}
              >
                <h3 className="task-name">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {left?.name ?? right?.name ?? "Task"}
                </h3>
                <TaskCell kind="baseline" now={now} task={left} />
                <TaskCell kind="candidate" now={now} task={right} />
              </article>
            );
          })}
        </section>
      )}

      <footer>
        Artifacts: <code>{status.outputDirectory}</code>
      </footer>
    </>
  );
}

function VariantCard({ variant }: { variant: Variant }) {
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
  const costComplete =
    variant.tasks.length > 0 &&
    variant.tasks.every((task) => task.costComplete);

  return (
    <article className="variant">
      <div className="variant-top">
        <div>
          <h2>{variant.kind}</h2>
          <code>
            {variant.ref} · {variant.sha.slice(0, 12)}
          </code>
        </div>
        <StatusBadge status={variant.status} />
      </div>
      <div className="metrics">
        <Metric
          label="passed"
          value={`${String(passed)}/${String(variant.tasks.length)}`}
        />
        <Metric label="running" value={String(running)} />
        <Metric label="failed" value={String(failed)} />
        <Metric label="LLM cost" value={formatCost(cost, costComplete)} />
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TaskCell({
  kind,
  now,
  task,
}: {
  kind: string;
  now: number;
  task?: Task;
}) {
  if (!task) {
    return (
      <div className={`task-cell waiting ${kind}`}>
        Waiting for this variant
      </div>
    );
  }
  const message =
    task.terminalMessage ??
    task.error ??
    (task.status === "running"
      ? "Agent is working…"
      : "No terminal message yet.");

  return (
    <div className={`task-cell ${kind}`}>
      <div className="task-top">
        <StatusBadge status={task.status} />
        <span>
          {formatDuration(
            task.durationMs ?? elapsed(task.startedAt, task.completedAt, now)
          )}{" "}
          · {formatCost(task.costUsd, task.costComplete)}
        </span>
      </div>
      <p
        className={
          task.terminalMessage || task.error ? "message" : "message muted"
        }
        title={message}
      >
        {message}
      </p>
      {task.sessions.length > 0 ? (
        <div className="details">
          {task.sessions.map((session) => (
            <span key={session.id}>
              {session.role}{" "}
              <code title={session.id}>{session.id.slice(0, 12)}</code>
            </span>
          ))}
        </div>
      ) : null}
      {Object.keys(task.toolCalls).length > 0 ? (
        <div className="tools">
          {Object.entries(task.toolCalls)
            .toSorted((left, right) => right[1] - left[1])
            .map(([name, count]) => (
              <code key={name}>
                {name} ×{count}
              </code>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

function EmptyState() {
  return (
    <section className="empty">
      <h2>No benchmark status yet</h2>
      <p>
        Run any A/B suite from another terminal. This page will pick it up
        automatically and will not manage its lifecycle.
      </p>
      <code>
        pnpm bench:ab &lt;baseline-ref&gt; &lt;candidate-ref&gt; --suite live
      </code>
    </section>
  );
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString();
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EveEvalResult, EveEvalRunSummary } from "eve/evals";
import type { EvalReporter } from "eve/evals/reporters";
import { browserBenchmarkEnv } from "@/evals/browser/env";
import {
  measureBrowserTask,
  readTaskCompletion,
  terminalBrowserMessage,
} from "@/lib/browser/benchmark";
import type { BrowserBenchmark } from "@/evals/browser/benchmark-schema";

const tableWidths = [34, 8, 10, 12, 64] as const;
const taskNames = new Map<string, string>();
const completedTasks = new Map<
  string,
  ReturnType<typeof summarizeTaskResult>
>();

export const browserBenchmarkReporter: EvalReporter = {
  onRunStart(evaluations) {
    taskNames.clear();
    completedTasks.clear();

    for (const evaluation of evaluations) {
      taskNames.set(evaluation.id, evaluation.description ?? evaluation.id);
    }

    console.log("");
    console.log(tableBorder());
    console.log(
      tableRow(["TASK", "RESULT", "TIME", "LLM COST", "TERMINAL MESSAGE"])
    );
    console.log(tableBorder());
  },
  onEvalComplete(result) {
    const task = summarizeTaskResult(
      result,
      taskNames.get(result.id) ?? result.id
    );
    completedTasks.set(result.id, task);
    console.log(
      tableRow([
        task.name,
        task.success ? "SUCCESS" : "FAILURE",
        formatDuration(task.durationMs),
        formatCost(task.costUsd, task.costComplete),
        task.terminalMessage,
      ])
    );
  },
  async onRunComplete(summary) {
    console.log(tableBorder());
    const benchmark = await buildBenchmark(summary);
    const artifactPath = await writeBenchmark(benchmark);

    console.log(
      `Success ${String(benchmark.summary.passed)}/${String(benchmark.tasks.length)} | median ${formatOptionalDuration(benchmark.summary.medianDurationMs)} | p95 ${formatOptionalDuration(benchmark.summary.p95DurationMs)} | total LLM cost ${formatCost(benchmark.summary.totalCostUsd, benchmark.summary.costComplete)}`
    );
    console.log(`Benchmark saved to ${artifactPath}`);
    console.log("");
  },
};

function summarizeTaskResult(result: EveEvalResult, name: string) {
  const metrics = measureBrowserTask(
    result.result.events,
    elapsedMs(result.startedAt, result.completedAt)
  );
  const fallbackMessage =
    result.result.finalMessage ??
    result.error ??
    result.skipReason ??
    "No reply";
  const completion = readTaskCompletion(result.result.events);
  const terminalMessage = terminalBrowserMessage(
    fallbackMessage,
    result.result.events
  );
  const workerFacts =
    result.result.sessions
      ?.filter((session) => !session.primary)
      .map((session) => session.derived) ?? [];
  const facts = workerFacts.length > 0 ? workerFacts : [result.result.derived];
  const calls = facts.flatMap((derived) => derived.toolCalls);
  const toolCalls = calls.reduce<Record<string, number>>((counts, call) => {
    counts[call.name] = (counts[call.name] ?? 0) + 1;
    return counts;
  }, {});
  const judge = result.assertions.find(
    (assertion) =>
      assertion.name === "judge.autoevals.closedQA [task completed]"
  );
  const rationale = judge?.metadata?.rationale;

  return {
    costComplete: metrics.costComplete,
    costUsd: metrics.costUsd,
    durationMs: metrics.durationMs,
    error: result.error ?? null,
    evalDurationMs: elapsedMs(result.startedAt, result.completedAt),
    failedToolCalls: calls.filter((call) => call.status === "failed").length,
    id: result.id,
    inputTokens: metrics.inputTokens,
    judgeRationale: typeof rationale === "string" ? rationale : null,
    judgeScore: judge?.score ?? null,
    messageCount: facts.reduce(
      (count, derived) => count + derived.messageCount,
      0
    ),
    modelSteps: metrics.modelSteps,
    name,
    outputTokens: metrics.outputTokens,
    reasoningBlockCount: facts.reduce(
      (count, derived) => count + derived.reasoningBlockCount,
      0
    ),
    sessionId: result.result.sessionId ?? null,
    status: result.result.status,
    success: result.verdict === "passed" && completion?.status === "success",
    terminalMessage,
    toolCalls,
    verdict: result.verdict,
  };
}

async function buildBenchmark(
  summary: EveEvalRunSummary
): Promise<BrowserBenchmark> {
  const tasks = summary.results.map(
    (result) =>
      completedTasks.get(result.id) ??
      summarizeTaskResult(result, taskNames.get(result.id) ?? result.id)
  );
  const successfulDurations = tasks
    .filter((task) => task.success)
    .map((task) => task.durationMs)
    .toSorted((left, right) => left - right);
  const measuredCosts = tasks.flatMap((task) =>
    task.costUsd === null ? [] : [task.costUsd]
  );
  const judgeScores = tasks.flatMap((task) =>
    task.judgeScore === null ? [] : [task.judgeScore]
  );
  const inputTokens = tasks.flatMap((task) =>
    task.inputTokens === null ? [] : [task.inputTokens]
  );
  const outputTokens = tasks.flatMap((task) =>
    task.outputTokens === null ? [] : [task.outputTokens]
  );
  const runtimeIdentity = summary.results.find(
    (result) => result.result.runtimeIdentity !== undefined
  )?.result.runtimeIdentity;
  const gitSha =
    runtimeIdentity?.build?.gitSha ?? (await readCurrentGitSha()) ?? null;
  const environmentLabel = browserBenchmarkEnv.BROWSER_BENCH_LABEL?.trim();

  return {
    completedAt: summary.completedAt,
    gitSha,
    label:
      environmentLabel && environmentLabel.length > 0
        ? environmentLabel
        : (gitSha?.slice(0, 12) ?? summary.startedAt),
    startedAt: summary.startedAt,
    summary: {
      costComplete:
        tasks.length > 0 && tasks.every((task) => task.costComplete),
      failed: tasks.filter((task) => !task.success).length,
      failedToolCalls: tasks.reduce(
        (count, task) => count + task.failedToolCalls,
        0
      ),
      meanJudgeScore:
        judgeScores.length === 0
          ? null
          : judgeScores.reduce((total, score) => total + score, 0) /
            judgeScores.length,
      medianDurationMs: percentile(successfulDurations, 0.5),
      passed: tasks.filter((task) => task.success).length,
      p95DurationMs: percentile(successfulDurations, 0.95),
      successRate: tasks.length === 0 ? 0 : summary.passed / tasks.length,
      totalInputTokens:
        inputTokens.length === 0
          ? null
          : inputTokens.reduce((total, tokens) => total + tokens, 0),
      totalModelSteps: tasks.reduce(
        (count, task) => count + task.modelSteps,
        0
      ),
      totalOutputTokens:
        outputTokens.length === 0
          ? null
          : outputTokens.reduce((total, tokens) => total + tokens, 0),
      totalToolCalls: tasks.reduce(
        (count, task) =>
          count +
          Object.values(task.toolCalls).reduce(
            (taskCount, calls) => taskCount + calls,
            0
          ),
        0
      ),
      totalCostUsd:
        measuredCosts.length === 0
          ? null
          : measuredCosts.reduce((total, cost) => total + cost, 0),
    },
    target: {
      kind: summary.target.kind,
      url: summary.target.url,
    },
    tasks,
    version: 1,
  };
}

async function readCurrentGitSha() {
  try {
    const gitDirectory = join(process.cwd(), ".git");
    const head = (await readFile(join(gitDirectory, "HEAD"), "utf8")).trim();
    const referencePrefix = "ref: ";

    if (!head.startsWith(referencePrefix)) {
      return /^[0-9a-f]{40}$/u.test(head) ? head : undefined;
    }

    const reference = head.slice(referencePrefix.length);
    if (!/^refs\/[a-zA-Z0-9._/-]+$/u.test(reference)) return undefined;
    const sha = (await readFile(join(gitDirectory, reference), "utf8")).trim();
    return /^[0-9a-f]{40}$/u.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function writeBenchmark(benchmark: BrowserBenchmark) {
  const directory = join(process.cwd(), ".eve", "browser-benchmarks");
  const safeLabel = benchmark.label.replaceAll(/[^a-zA-Z0-9._-]/gu, "-");
  const timestamp = benchmark.startedAt.replaceAll(":", "-");
  const artifactPath = join(directory, `${timestamp}-${safeLabel}.json`);
  const serialized = `${JSON.stringify(benchmark, null, 2)}\n`;

  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(artifactPath, serialized, "utf8"),
    writeFile(join(directory, "latest.json"), serialized, "utf8"),
  ]);

  return artifactPath;
}

function percentile(sortedValues: readonly number[], percentileValue: number) {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(sortedValues.length * percentileValue) - 1;
  return sortedValues[Math.max(0, index)] ?? null;
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function formatDuration(milliseconds: number) {
  return milliseconds < 1_000
    ? `${String(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatOptionalDuration(milliseconds: number | null) {
  return milliseconds === null ? "—" : formatDuration(milliseconds);
}

function formatCost(costUsd: number | null, complete: boolean) {
  if (costUsd === null) return "—";
  return `${complete ? "" : "~"}$${costUsd.toFixed(6)}`;
}

function tableBorder() {
  return `+${tableWidths.map((width) => "-".repeat(width + 2)).join("+")}+`;
}

function tableRow(values: readonly string[]) {
  const cells = tableWidths.map((width, index) => {
    const value = values[index] ?? "";
    const clipped =
      value.length > width
        ? `${value.slice(0, Math.max(0, width - 1))}…`
        : value;
    return ` ${clipped.padEnd(width)} `;
  });
  return `|${cells.join("|")}|`;
}

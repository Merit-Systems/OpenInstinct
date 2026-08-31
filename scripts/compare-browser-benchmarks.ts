import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { browserBenchmarkSchema } from "../evals/browser/benchmark-schema.ts";

const tableWidths = [30, 8, 11, 11, 12, 12, 12, 12] as const;
const [baselineArgument, candidateArgument] = process.argv.slice(2);

if (!baselineArgument || !candidateArgument) {
  throw new Error("Usage: pnpm bench:compare <baseline.json> <candidate.json>");
}

const [baseline, candidate] = await Promise.all([
  readBenchmark(baselineArgument),
  readBenchmark(candidateArgument),
]);
const candidateTasks = new Map(candidate.tasks.map((task) => [task.id, task]));
const pairs = baseline.tasks.flatMap((baselineTask) => {
  const candidateTask = candidateTasks.get(baselineTask.id);
  return candidateTask
    ? [{ baseline: baselineTask, candidate: candidateTask }]
    : [];
});

console.log("");
console.log(`Browser benchmark: ${baseline.label} → ${candidate.label}`);
console.log(tableBorder());
console.log(
  tableRow([
    "TASK",
    "RESULT",
    "BASE TIME",
    "NEW TIME",
    "TIME Δ",
    "BASE COST",
    "NEW COST",
    "COST Δ",
  ])
);
console.log(tableBorder());

for (const pair of pairs) {
  console.log(
    tableRow([
      pair.baseline.name,
      `${pair.baseline.success ? "✓" : "✗"}→${pair.candidate.success ? "✓" : "✗"}`,
      formatDuration(pair.baseline.durationMs),
      formatDuration(pair.candidate.durationMs),
      formatDelta(pair.baseline.durationMs, pair.candidate.durationMs, "ms"),
      formatCost(pair.baseline.costUsd),
      formatCost(pair.candidate.costUsd),
      formatNullableDelta(pair.baseline.costUsd, pair.candidate.costUsd, "$"),
    ])
  );
}

console.log(tableBorder());
console.log(
  `Success: ${formatRate(baseline.summary.successRate)} → ${formatRate(candidate.summary.successRate)}`
);
console.log(
  `Median: ${formatOptionalDuration(baseline.summary.medianDurationMs)} → ${formatOptionalDuration(candidate.summary.medianDurationMs)} (${formatNullableDelta(baseline.summary.medianDurationMs, candidate.summary.medianDurationMs, "ms")})`
);
console.log(
  `P95: ${formatOptionalDuration(baseline.summary.p95DurationMs)} → ${formatOptionalDuration(candidate.summary.p95DurationMs)} (${formatNullableDelta(baseline.summary.p95DurationMs, candidate.summary.p95DurationMs, "ms")})`
);
console.log(
  `LLM cost: ${formatCost(baseline.summary.totalCostUsd)} → ${formatCost(candidate.summary.totalCostUsd)} (${formatNullableDelta(baseline.summary.totalCostUsd, candidate.summary.totalCostUsd, "$")})`
);
console.log(
  `Judge score: ${formatScore(baseline.summary.meanJudgeScore)} → ${formatScore(candidate.summary.meanJudgeScore)}`
);
console.log(
  `Model steps: ${String(baseline.summary.totalModelSteps)} → ${String(candidate.summary.totalModelSteps)}`
);
console.log(
  `Tool calls: ${String(baseline.summary.totalToolCalls)} → ${String(candidate.summary.totalToolCalls)} (failed ${String(baseline.summary.failedToolCalls)} → ${String(candidate.summary.failedToolCalls)})`
);
console.log(
  `Tokens (input/output): ${formatTokens(baseline.summary.totalInputTokens)}/${formatTokens(baseline.summary.totalOutputTokens)} → ${formatTokens(candidate.summary.totalInputTokens)}/${formatTokens(candidate.summary.totalOutputTokens)}`
);
console.log(`Baseline tool mix: ${formatToolMix(baseline.tasks)}`);
console.log(`Candidate tool mix: ${formatToolMix(candidate.tasks)}`);
console.log("");

async function readBenchmark(filePath: string) {
  const contents = await readFile(resolve(filePath), "utf8");
  return browserBenchmarkSchema.parse(JSON.parse(contents));
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

function formatDuration(milliseconds: number) {
  return milliseconds < 1_000
    ? `${String(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatOptionalDuration(milliseconds: number | null) {
  return milliseconds === null ? "—" : formatDuration(milliseconds);
}

function formatCost(costUsd: number | null) {
  return costUsd === null ? "—" : `$${costUsd.toFixed(6)}`;
}

function formatRate(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatScore(score: number | null) {
  return score === null ? "—" : score.toFixed(2);
}

function formatTokens(tokens: number | null) {
  return tokens === null ? "—" : tokens.toLocaleString("en-US");
}

function formatToolMix(tasks: (typeof baseline.tasks)[number][]) {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const [name, calls] of Object.entries(task.toolCalls)) {
      counts.set(name, (counts.get(name) ?? 0) + calls);
    }
  }
  return [...counts.entries()]
    .toSorted(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .map(([name, calls]) => `${name} ${String(calls)}`)
    .join(", ");
}

function formatNullableDelta(
  baselineValue: number | null,
  candidateValue: number | null,
  unit: "$" | "ms"
) {
  return baselineValue === null || candidateValue === null
    ? "—"
    : formatDelta(baselineValue, candidateValue, unit);
}

function formatDelta(
  baselineValue: number,
  candidateValue: number,
  unit: "$" | "ms"
) {
  if (baselineValue === 0) return "n/a";
  const absolute = candidateValue - baselineValue;
  const percent = (absolute / baselineValue) * 100;
  const sign = absolute > 0 ? "+" : "";
  const absoluteText =
    unit === "$"
      ? `${sign}$${absolute.toFixed(6)}`
      : `${sign}${String(Math.round(absolute))}ms`;
  return `${absoluteText} (${sign}${percent.toFixed(1)}%)`;
}

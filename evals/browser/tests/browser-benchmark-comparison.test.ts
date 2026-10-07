import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { browserBenchmarkSchema } from "../benchmark-schema";
import { measureWorkerTask } from "../worker-events";
import {
  averageBenchmarkImprovement,
  compareBenchmarkTasks,
} from "../dashboard/lib/benchmark-comparison";

describe("browser benchmark comparison", () => {
  it("reports positive improvement when the candidate is faster and cheaper", () => {
    expect(
      compareBenchmarkTasks(
        {
          costComplete: true,
          costUsd: 2,
          durationMs: 10_000,
          id: "task",
          success: true,
        },
        {
          costComplete: true,
          costUsd: 1.5,
          durationMs: 8_000,
          id: "task",
          success: true,
        }
      )
    ).toEqual({ cost: -0.25, time: -0.2 });
  });

  it("averages paired per-test improvements", () => {
    expect(
      averageBenchmarkImprovement(
        [
          {
            costComplete: true,
            costUsd: 2,
            durationMs: 10_000,
            id: "one",
            success: true,
          },
          {
            costComplete: true,
            costUsd: 1,
            durationMs: 20_000,
            id: "two",
            success: true,
          },
        ],
        [
          {
            costComplete: true,
            costUsd: 1,
            durationMs: 5_000,
            id: "one",
            success: true,
          },
          {
            costComplete: true,
            costUsd: 2,
            durationMs: 30_000,
            id: "two",
            success: true,
          },
        ]
      )
    ).toEqual({ cost: 0.25, time: 0 });
  });

  it("excludes pairs unless both variants passed", () => {
    const baseline = {
      costComplete: true,
      costUsd: 2,
      durationMs: 10_000,
      id: "task",
      success: true,
    };
    const candidate = {
      costComplete: true,
      costUsd: 1,
      durationMs: 5_000,
      id: "task",
      success: false,
    };

    expect(compareBenchmarkTasks(baseline, candidate)).toEqual({
      cost: null,
      time: null,
    });
    expect(averageBenchmarkImprovement([baseline], [candidate])).toEqual({
      cost: null,
      time: null,
    });
  });
  it("excludes incomplete measured costs without discarding duration comparisons", () => {
    const baseline = measuredTask(2, true);
    const candidate = measuredTask(1, false);
    expect(candidate).toMatchObject({ costComplete: false, costUsd: 1 });
    expect(compareBenchmarkTasks(baseline, candidate)).toEqual({
      cost: null,
      time: 0,
    });
    expect(compareBenchmarkTasks(candidate, baseline)).toEqual({
      cost: null,
      time: 0,
    });
    expect(averageBenchmarkImprovement([baseline], [candidate])).toEqual({
      cost: null,
      time: 0,
    });
  });

  it("marks partial CLI costs and compares only shared complete measurements", () => {
    const directory = mkdtempSync(join(tmpdir(), "benchmark-costs-"));
    try {
      const baselinePath = join(directory, "baseline.json");
      const candidatePath = join(directory, "candidate.json");
      writeFileSync(
        baselinePath,
        JSON.stringify(benchmark("baseline", measuredTask(2, true)))
      );
      writeFileSync(
        candidatePath,
        JSON.stringify(benchmark("candidate", measuredTask(1, false)))
      );
      const partial = execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/compare-browser-benchmarks.ts",
          baselinePath,
          candidatePath,
        ],
        { encoding: "utf8", timeout: 10_000 }
      );
      expect(partial).toContain("~$1.000000");
      expect(partial).toContain(
        "Comparable LLM cost (0 shared complete measurements): — → — (—)"
      );
      expect(partial).not.toContain("(-50.0%)");
      writeFileSync(
        candidatePath,
        JSON.stringify(benchmark("candidate", measuredTask(1, true)))
      );
      const complete = execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/compare-browser-benchmarks.ts",
          baselinePath,
          candidatePath,
        ],
        { encoding: "utf8", timeout: 10_000 }
      );
      expect(complete).toContain(
        "Comparable LLM cost (1 shared complete measurements): $2.000000 → $1.000000 ($-1.000000 (-50.0%))"
      );
      expect(complete).not.toContain("~$");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function measuredTask(costUsd: number, complete: boolean) {
  const events: MessageStreamEvent[] = [
    {
      data: {
        finishReason: "stop",
        sequence: 0,
        stepIndex: 0,
        turnId: "turn",
        usage: { costUsd },
      },
      meta: { at: "2026-10-07T06:00:00.000Z", id: "measured" },
      type: "step.completed",
    },
  ];
  if (!complete)
    events.push({
      data: {
        finishReason: "stop",
        sequence: 1,
        stepIndex: 1,
        turnId: "turn",
        usage: {},
      },
      meta: { at: "2026-10-07T06:00:01.000Z", id: "unmeasured" },
      type: "step.completed",
    });
  return { ...measureWorkerTask(events, 1000), id: "task", success: true };
}

function benchmark(label: string, task: ReturnType<typeof measuredTask>) {
  return browserBenchmarkSchema.parse({
    completedAt: "2026-10-07T06:00:01.000Z",
    gitSha: null,
    label,
    startedAt: "2026-10-07T06:00:00.000Z",
    summary: {
      costComplete: task.costComplete,
      failed: 0,
      passed: 1,
      medianDurationMs: 1000,
      p95DurationMs: 1000,
      successRate: 1,
      totalModelSteps: task.modelSteps,
      totalCostUsd: task.costUsd,
    },
    target: { kind: "local", url: "http://127.0.0.1:9" },
    tasks: [
      {
        ...task,
        error: null,
        evalDurationMs: 1000,
        name: "measured cost",
        sessionId: "fixture",
        status: "completed",
        terminalMessage: "done",
        verdict: "passed",
      },
    ],
    version: 1,
  });
}

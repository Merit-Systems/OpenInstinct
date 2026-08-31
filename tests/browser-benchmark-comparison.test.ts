import { describe, expect, it } from "vitest";
import {
  averageBenchmarkImprovement,
  compareBenchmarkTasks,
} from "../evals/browser/dashboard/lib/benchmark-comparison";

describe("browser benchmark comparison", () => {
  it("reports positive improvement when the candidate is faster and cheaper", () => {
    expect(
      compareBenchmarkTasks(
        { costUsd: 2, durationMs: 10_000, id: "task" },
        { costUsd: 1.5, durationMs: 8_000, id: "task" }
      )
    ).toEqual({ cost: -0.25, time: -0.2 });
  });

  it("averages paired per-test improvements", () => {
    expect(
      averageBenchmarkImprovement(
        [
          { costUsd: 2, durationMs: 10_000, id: "one" },
          { costUsd: 1, durationMs: 20_000, id: "two" },
        ],
        [
          { costUsd: 1, durationMs: 5_000, id: "one" },
          { costUsd: 2, durationMs: 30_000, id: "two" },
        ]
      )
    ).toEqual({ cost: 0.25, time: 0 });
  });
});

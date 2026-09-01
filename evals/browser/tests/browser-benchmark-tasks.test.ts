import { describe, expect, it } from "vitest";
import {
  browserBenchmarkFixtureContext,
  browserBenchmarkTasks,
} from "@/evals/browser/tasks";

describe("browser benchmark tasks", () => {
  it("includes the focused Peek next-month calendar regression", () => {
    const task = browserBenchmarkTasks("all").find((candidate) =>
      candidate.prompt.includes("peek.com")
    );

    expect(task).toBeDefined();
    expect(task?.prompt).toContain("next calendar month");
    expect(task?.prompt).toContain("exactly one Adult");
    expect(task?.prompt).toContain("earliest enabled tour date");
  });

  it("keeps the smoke suite bounded to its existing two tasks", () => {
    expect(browserBenchmarkTasks("smoke")).toHaveLength(2);
  });

  it("includes six additional live checkout workflows", () => {
    const descriptions = browserBenchmarkTasks("all").map(
      (task) => task.description
    );

    expect(browserBenchmarkTasks("all")).toHaveLength(12);
    expect(descriptions).toEqual(
      expect.arrayContaining([
        "Reach checkout for a Yankees game",
        "Reach checkout for an Elsewhere concert",
        "Choose a facial moisturizer and reach checkout",
        "Reach checkout for a nonstop flight",
        "Reach checkout for a weekend car rental",
        "Reach checkout for a Home Depot purchase",
      ])
    );
  });

  it("includes a Home Depot final-order boundary task", () => {
    const task = browserBenchmarkTasks("all").find((candidate) =>
      candidate.prompt.includes("Home Depot's official website")
    );

    expect(task).toBeDefined();
    expect(task?.prompt).toContain("delivery to ZIP code 11201");
    expect(task?.prompt).toContain("continue as a guest");
    expect(task?.prompt).toContain("final Place Order or purchase control");
    expect(task?.successCriteria).toContain("did not place the order");
  });

  it("tells the judge that personal and payment values are fixtures", () => {
    expect(browserBenchmarkFixtureContext).toContain("synthetic test fixtures");
    expect(browserBenchmarkFixtureContext).toContain("payment-card");
  });

  it("scopes Apple's address-correction rule to the Apple task", () => {
    const tasks = browserBenchmarkTasks("all");
    const appleTask = tasks.find((task) => task.prompt.includes("Apple's"));

    expect(appleTask).toHaveProperty("judgeContext");
    if (!appleTask || !("judgeContext" in appleTask)) {
      throw new Error("Apple benchmark task has no judge context.");
    }
    expect(appleTask.judgeContext).toContain("11222");
    expect(
      tasks.filter((task) => "judgeContext" in task && task.judgeContext)
    ).toHaveLength(1);
  });
});

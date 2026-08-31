import { describe, expect, it } from "vitest";
import { browserBenchmarkTasks } from "@/lib/browser/benchmark-tasks";

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
});

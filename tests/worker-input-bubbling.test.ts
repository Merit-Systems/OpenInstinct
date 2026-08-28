import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("worker input bubbling", () => {
  it("keeps native questions disabled", () => {
    const askQuestionTool = readFileSync("agent/tools/ask_question.ts", "utf8");

    expect(askQuestionTool).toMatch(/disableTool\(\)/);
  });

  it("ends the worker turn and routes the answer through its agent id", () => {
    const instructions = readFileSync("agent/instructions.md", "utf8");
    const workerInstructions = readFileSync(
      "agent/subagents/worker/instructions.md",
      "utf8"
    );

    expect(instructions).toContain(
      "Ask the user directly in ordinary assistant text"
    );
    expect(instructions).toContain("continue that worker with its `agentId`");
    expect(instructions).toContain("returns a `Needs user input:` blocker");
    expect(workerInstructions).toContain(
      "native `final_output` tool exactly once"
    );
    expect(workerInstructions).toContain("End the turn immediately");
  });
});

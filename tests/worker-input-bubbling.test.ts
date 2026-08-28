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
    const browserSkill = readFileSync(
      "agent/subagents/worker/skills/browser-execution/SKILL.md",
      "utf8"
    );

    expect(instructions).toContain("Relay actionable questions");
    expect(instructions).toContain(
      "Continue the same parked worker after an answer"
    );
    expect(workerInstructions).toContain("return `Needs user input:`");
    expect(workerInstructions).toContain("Call `final_output` exactly once");
    expect(browserSkill).toContain("Ask the coordinator for a textual OTP");
    expect(browserSkill).toContain("Preserve the browser");
  });
});

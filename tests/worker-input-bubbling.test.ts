import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coordinatorRoot = "agent/subagents/coordinator";
const browserRoot = `${coordinatorRoot}/subagents/browser`;

describe("nested browser input bubbling", () => {
  it("keeps native questions disabled at every model boundary", () => {
    for (const path of [
      "agent/tools/ask_question.ts",
      `${coordinatorRoot}/tools/ask_question.ts`,
      `${browserRoot}/tools/ask_question.ts`,
    ]) {
      expect(readFileSync(path, "utf8")).toMatch(/disableTool\(\)/);
    }
  });

  it("routes browser blockers through the coordinator and root agent ids", () => {
    const rootInstructions = readFileSync("agent/instructions.md", "utf8");
    const coordinatorInstructions = readFileSync(
      `${coordinatorRoot}/instructions.md`,
      "utf8"
    );
    const browserSkill = readFileSync(
      `${browserRoot}/skills/browser-execution/SKILL.md`,
      "utf8"
    );

    expect(rootInstructions).toContain(
      "Ask the user directly in ordinary assistant text"
    );
    expect(rootInstructions).toContain(
      "continue the same coordinator with its `agentId`"
    );
    expect(coordinatorInstructions).toContain(
      "resume that same child after the root supplies the user's response"
    );
    expect(coordinatorInstructions).toContain("`Needs user input:`");
    expect(browserSkill).toContain("native `final_output` with `failure`");
    expect(browserSkill).toContain("End the turn immediately");
  });
});

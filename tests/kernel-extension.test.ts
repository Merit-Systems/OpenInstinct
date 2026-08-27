import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import kernelConnection from "../agent/extensions/kernel/connections/browser";

describe("Kernel Eve extension", () => {
  it("does not expose a second backend-specific browser toolset", () => {
    expect(kernelConnection.tools).toEqual({ allow: [] });
  });

  it("keeps executor selection out of model instructions", () => {
    const instructions = [
      readFileSync("agent/instructions.md", "utf8"),
      readFileSync("agent/skills/browser-execution/SKILL.md", "utf8"),
      readFileSync("agent/extensions/kernel/skills/browse.md", "utf8"),
    ].join("\n");
    expect(instructions).not.toMatch(
      /cloud browser|local browser|browser mode|browser executor|kernel__browser/i
    );
  });

  it("keeps Kernel's managed CAPTCHA solver enabled and actionable", () => {
    const instructions = [
      readFileSync("agent/instructions.md", "utf8"),
      readFileSync("agent/skills/browser-execution/SKILL.md", "utf8"),
    ].join("\n");
    const browserRuntime = readFileSync(
      "agent/extensions/kernel/browser-runtime.ts",
      "utf8"
    );

    expect(browserRuntime).toMatch(/stealth:\s*true/);
    expect(instructions).toMatch(/managed (?:automatic )?CAPTCHA solver/i);
    expect(instructions).toMatch(/leave (?:it|challenges) untouched/i);
    expect(instructions).not.toMatch(/do not bypass[^\n]*CAPTCHAs/i);
  });
});

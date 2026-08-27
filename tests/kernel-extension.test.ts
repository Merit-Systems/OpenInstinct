import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKernelSystemToken,
  kernelToolAllowlist,
} from "../agent/extensions/kernel/connections/browser";

afterEach(() => vi.unstubAllEnvs());

describe("Kernel Eve extension", () => {
  it("does not expose a second backend-specific browser toolset", () => {
    expect(kernelToolAllowlist).toEqual([]);
  });

  it("uses the system Kernel key for cloud execution", () => {
    vi.stubEnv("KERNEL_API_KEY", "system-kernel-key");
    expect(getKernelSystemToken()).toBe("system-kernel-key");
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
});

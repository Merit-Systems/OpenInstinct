import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootTools = "agent/tools";
const coordinatorRoot = "agent/subagents/coordinator";
const coordinatorTools = `${coordinatorRoot}/tools`;
const browserRoot = `${coordinatorRoot}/subagents/browser`;
const browserTools = `${browserRoot}/tools`;

function toolFiles(directory: string) {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".ts"))
    .toSorted();
}

describe("root, coordinator, and browser capability boundaries", () => {
  it("keeps the root focused on user interaction and delegation", () => {
    expect(toolFiles(rootTools)).toEqual([
      "agent.ts",
      "ask_question.ts",
      "bash.ts",
      "read_file.ts",
      "todo.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    for (const tool of toolFiles(rootTools)) {
      expect(readFileSync(`${rootTools}/${tool}`, "utf8")).toContain(
        "disableTool()"
      );
    }

    const rootConfig = readFileSync("agent/agent.ts", "utf8");
    expect(rootConfig).toContain('model: "openai/gpt-5.6-sol-fast"');
    expect(rootConfig).toContain('reasoning: "minimal"');

    const rootInstructions = readFileSync("agent/instructions.md", "utf8");
    expect(rootInstructions).toContain(
      "Delegate every request that requires public research"
    );
    expect(rootInstructions).toContain(
      "Every initial or resumed `coordinator` call must set `outputSchema`"
    );
    expect(rootInstructions).not.toContain(
      "Perform public research, source discovery"
    );
  });

  it("gives the coordinator research and service tools but no browser tools", () => {
    expect(toolFiles(coordinatorTools)).toEqual([
      "ask_question.ts",
      "bash.ts",
      "google_workspace_read.ts",
      "google_workspace_write.ts",
      "read_file.ts",
      "request_vault_setup.ts",
      "todo.ts",
      "write_file.ts",
    ]);
    for (const tool of [
      "ask_question",
      "bash",
      "read_file",
      "todo",
      "write_file",
    ]) {
      expect(readFileSync(`${coordinatorTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${coordinatorTools}/manage_browsers.ts`)).toBe(false);
    expect(existsSync(`${coordinatorRoot}/hooks/session-owner.ts`)).toBe(true);

    const instructions = readFileSync(
      `${coordinatorRoot}/instructions.md`,
      "utf8"
    );
    expect(instructions).toContain(
      "Perform public research, comparisons, and source discovery directly with `web_search`"
    );
    expect(instructions).toContain("Try `web_fetch` before browser automation");
    expect(instructions).toContain("Call the browser inline");
  });

  it("gives the nested browser only browser and opaque-vault capabilities", () => {
    expect(toolFiles(browserTools)).toEqual([
      "ask_question.ts",
      "bash.ts",
      "computer_action.ts",
      "execute_playwright_code.ts",
      "fill_from_vault.ts",
      "list_vault.ts",
      "manage_browsers.ts",
      "read_file.ts",
      "todo.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    for (const tool of [
      "ask_question",
      "bash",
      "read_file",
      "todo",
      "web_fetch",
      "web_search",
      "write_file",
    ]) {
      expect(readFileSync(`${browserTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${browserTools}/sendMessage.ts`)).toBe(false);
    expect(existsSync(`${browserTools}/request_vault_setup.ts`)).toBe(false);
    expect(existsSync(`${browserRoot}/hooks/session-owner.ts`)).toBe(true);
    expect(existsSync(`${browserRoot}/skills/browser-execution/SKILL.md`)).toBe(
      true
    );

    for (const tool of [
      "computer_action",
      "execute_playwright_code",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${browserTools}/${tool}.ts`, "utf8");
      expect(source).toContain("defineTool(");
      expect(source).not.toContain("defineDynamic(");
      expect(source).toContain("requireWorkerScope(context)");
      expect(source).toContain('from "@/lib/kernel"');
      expect(source).not.toContain("new Kernel(");
    }

    const instructions = readFileSync(`${browserRoot}/instructions.md`, "utf8");
    expect(instructions).not.toContain("`inspect_autofill`");
    expect(instructions).toContain("native `final_output` tool exactly once");
    expect(instructions).toContain(
      "Never use the browser for general web search"
    );
    expect(existsSync(`${browserRoot}/lib/owned-browser.ts`)).toBe(true);
    expect(readFileSync("lib/kernel.ts", "utf8")).toContain("new Kernel(");
    expect(
      readFileSync(`${browserTools}/fill_from_vault.ts`, "utf8")
    ).toContain('from "@/lib/manager/server/kernel-native-autofill"');
  });

  it("requires structured completion at both delegation boundaries", () => {
    const rootInstructions = readFileSync("agent/instructions.md", "utf8");
    const coordinatorInstructions = readFileSync(
      `${coordinatorRoot}/instructions.md`,
      "utf8"
    );
    const coordinatorConfig = readFileSync(
      `${coordinatorRoot}/agent.ts`,
      "utf8"
    );
    const browserConfig = readFileSync(`${browserRoot}/agent.ts`, "utf8");

    expect(rootInstructions).toContain(
      "Every initial or resumed `coordinator` call must set `outputSchema`"
    );
    expect(coordinatorInstructions).toContain(
      "Every initial or resumed `browser` call must set `outputSchema`"
    );
    expect(rootInstructions).toContain('"required": ["status", "message"]');
    expect(coordinatorInstructions).toContain(
      '"required": ["status", "message"]'
    );
    expect(coordinatorConfig).toContain("outputSchema: taskCompletionSchema");
    expect(browserConfig).toContain("outputSchema: taskCompletionSchema");
  });
});

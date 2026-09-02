import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootTools = "agent/tools";
const rootMemory = "agent/memory/profile.ts";
const workerRoot = "agent/subagents/worker";
const workerTools = `${workerRoot}/tools`;

function toolFiles(directory: string) {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".ts"))
    .toSorted();
}

describe("root and worker capability boundaries", () => {
  it("keeps root coordination separate from browser execution", () => {
    expect(toolFiles(rootTools)).toEqual([
      "agent.ts",
      "agentcash_access_status.ts",
      "agentcash_check_endpoint_schema.ts",
      "agentcash_discover_api_endpoints.ts",
      "agentcash_fetch.ts",
      "agentcash_get_balance.ts",
      "agentcash_get_settings.ts",
      "agentcash_list_accounts.ts",
      "agentcash_mcp.ts",
      "agentcash_search.ts",
      "ask_question.ts",
      "coinbase_access_status.ts",
      "coinbase_create_order.ts",
      "coinbase_mcp.ts",
      "coinbase_preview_order.ts",
      "google_workspace_read.ts",
      "google_workspace_write.ts",
      "publish_artifact.ts",
      "request_vault_import.ts",
      "request_vault_setup.ts",
      "update_user_profile.ts",
    ]);
    expect(existsSync(`${rootTools}/sendMessage.ts`)).toBe(false);
    expect(existsSync("agent/extensions/kernel/extension.ts")).toBe(false);
    expect(existsSync("agent/extensions/kernel/connections/browser.ts")).toBe(
      false
    );
    expect(existsSync("agent/skills/browser-execution/SKILL.md")).toBe(false);
    expect(readFileSync(`${rootTools}/agent.ts`, "utf8")).toContain(
      "disableTool()"
    );
    expect(readFileSync(`${rootTools}/ask_question.ts`, "utf8")).toContain(
      "disableTool()"
    );
    expect(readFileSync("agent/lib/agentcash-mcp.ts", "utf8")).toContain(
      'args: [agentcashCliPath, "server"]'
    );
    expect(readFileSync("agent/lib/agentcash-cli.ts", "utf8")).toContain(
      "HOME: homeDirectory"
    );
    const rootInstructions = readFileSync("agent/instructions.md", "utf8");
    expect(rootInstructions).toContain(
      "Perform public research, source discovery, comparisons, and current-information lookups directly with `web_search`"
    );
    expect(rootInstructions).toContain(
      "try `web_fetch` before browser automation"
    );
  });

  it("keeps durable memory scoped to the authenticated root user", () => {
    const memory = readFileSync(rootMemory, "utf8");

    expect(memory).toContain("defineMemory(");
    expect(memory).toContain("scope: resolveProfileMemoryScope");
  });

  it("gives worker the browser and opaque-vault tools without messaging", () => {
    expect(toolFiles(workerTools)).toEqual([
      "ask_question.ts",
      "bash.ts",
      "capture_browser_image.ts",
      "computer_action.ts",
      "fill_from_vault.ts",
      "list_vault.ts",
      "load_skill.ts",
      "manage_browsers.ts",
      "read_file.ts",
      "semantic_browser.ts",
      "todo.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]);
    expect(existsSync(`${workerRoot}/tools/sendMessage.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/tools/request_vault_setup.ts`)).toBe(
      false
    );
    expect(readFileSync(`${workerTools}/ask_question.ts`, "utf8")).toContain(
      "disableTool()"
    );
    for (const tool of [
      "bash",
      "load_skill",
      "read_file",
      "todo",
      "web_fetch",
      "web_search",
      "write_file",
    ]) {
      expect(readFileSync(`${workerTools}/${tool}.ts`, "utf8")).toContain(
        "disableTool()"
      );
    }
    expect(existsSync(`${workerRoot}/extensions/kernel/extension.ts`)).toBe(
      false
    );
    expect(readFileSync("package.json", "utf8")).not.toContain(
      "@onkernel/eve-extension"
    );
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${workerTools}/${tool}.ts`, "utf8");
      expect(source).toContain("defineTool(");
      expect(source).not.toContain("defineDynamic(");
      expect(source).toContain("requireWorkerScope(context)");
    }
    expect(existsSync(`${workerRoot}/hooks/session-owner.ts`)).toBe(true);
    expect(existsSync(`${workerRoot}/skills/browser-execution/SKILL.md`)).toBe(
      false
    );
    const semanticBrowser = readFileSync(
      `${workerTools}/semantic_browser.ts`,
      "utf8"
    );
    expect(semanticBrowser).toContain("defineDynamic(");
    expect(semanticBrowser).toContain("requireWorkerScope(context)");
    expect(semanticBrowser).toContain('from "@onkernel/browser-loop"');
    const workerInstructions = readFileSync(
      `${workerRoot}/instructions.md`,
      "utf8"
    );
    expect(workerInstructions).not.toContain("`inspect_autofill`");
    expect(workerInstructions).toContain(
      "native `final_output` tool exactly once"
    );
    expect(workerInstructions).toContain(
      "Never use the browser for general web search"
    );
    expect(workerInstructions).toContain(
      "Use `playwright_execute` as the primary browser execution surface"
    );
    expect(workerInstructions).toContain(
      "Prefer one bounded program per page state"
    );
    expect(workerInstructions).toContain(
      "`browser_act` dispatches actions and returns the successor state"
    );
    expect(existsSync(`${workerRoot}/lib/browser-contract.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/browser-runtime.ts`)).toBe(false);
    expect(existsSync(`${workerRoot}/lib/owned-browser.ts`)).toBe(true);

    expect(readFileSync("src/lib/kernel.ts", "utf8")).toContain("new Kernel(");
    for (const tool of [
      "capture_browser_image",
      "computer_action",
      "manage_browsers",
    ]) {
      const source = readFileSync(`${workerTools}/${tool}.ts`, "utf8");
      expect(source).toContain('from "@/lib/kernel"');
      expect(source).not.toContain("new Kernel(");
    }
    expect(readFileSync(`${workerTools}/fill_from_vault.ts`, "utf8")).toContain(
      'from "../lib/autofill/native"'
    );
  });

  it("requires structured completion for initial and resumed worker calls", () => {
    const rootInstructions = readFileSync("agent/instructions.md", "utf8");
    const workerConfig = readFileSync(`${workerRoot}/agent.ts`, "utf8");

    expect(rootInstructions).toContain(
      "Every initial or resumed `worker` call must set `outputSchema`"
    );
    expect(rootInstructions).toContain(
      '"required": ["status", "message", "images"]'
    );
    expect(rootInstructions).toContain(
      "including when passing an existing `agentId`"
    );
    expect(rootInstructions).toContain(
      "calling Eve's native `final_output` tool exactly once"
    );
    expect(workerConfig).toContain("outputSchema: taskCompletionSchema");
    expect(workerConfig).toContain(
      "Every initial and resumed call must include the task-completion outputSchema"
    );
  });
});

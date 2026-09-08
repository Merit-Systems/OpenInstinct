import type * as RuntimeSubagentConfig from "../node_modules/eve/dist/src/runtime/subagents/dynamic-agent-config.js";
import type * as RuntimeContext from "../node_modules/eve/dist/src/context/container.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import browserAgent from "@agent/subagents/browser-agent/agent";

// Use the same normalization boundary as real delegation; calling the authored
// resolver alone does not validate which fields Eve accepts at runtime.
const { normalizeDynamicSubagentAgentConfig } = await vi.importActual<
  typeof RuntimeSubagentConfig
>(
  new URL(
    "./runtime/subagents/dynamic-agent-config.js",
    import.meta.resolve("eve")
  ).pathname
);
const { ContextContainer } = await vi.importActual<typeof RuntimeContext>(
  new URL("./context/container.js", import.meta.resolve("eve")).pathname
);

describe("worker input bubbling", () => {
  it("keeps native questions disabled inside browser workers", () => {
    const askQuestionTool = readFileSync(
      "agent/subagents/browser-agent/tools/ask_question.ts",
      "utf8"
    );

    expect(askQuestionTool).toMatch(/disableTool\(\)/);
  });

  it("accepts the selected browser worker through Eve's runtime normalization", async () => {
    const worker = await browserAgent.events["turn.started"]?.(
      {},
      {
        channel: { kind: "channel:linq", metadata: {} },
        messages: [],
        session: {
          auth: { current: null, initiator: null },
          id: "worker-test",
        },
      }
    );
    await expect(
      normalizeDynamicSubagentAgentConfig({
        name: "browser-agent",
        value: worker,
        state: new ContextContainer(),
      })
    ).resolves.toMatchObject({ model: { id: "zai/glm-5.2" } });
  });

  it("ends the worker turn and routes the answer through its agent id", () => {
    const instructions = readFileSync(
      "agent/instructions/content/role/interactive.md",
      "utf8"
    );
    const workerInstructions = readFileSync(
      "agent/subagents/browser-agent/instructions.md",
      "utf8"
    );

    expect(instructions).toContain("continue that worker with its `agentId`");
    expect(instructions).toContain(
      "Before surfacing a `Needs user input:` blocker"
    );
    expect(instructions).toContain(
      "confirm the worker explicitly reported checking compatible vault items"
    );
    expect(workerInstructions).toContain(
      "Before returning `Needs user input:` or `Needs vault setup:`"
    );
    expect(workerInstructions).toContain("select the relevant compatible item");
    expect(workerInstructions).toContain(
      "native `final_output` tool exactly once"
    );
    expect(workerInstructions).toContain("End the turn immediately");
  });
});

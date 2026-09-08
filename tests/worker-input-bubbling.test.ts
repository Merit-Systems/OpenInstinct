import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import browserAgent from "@agent/subagents/browser-agent/agent";

describe("worker input bubbling", () => {
  it("keeps native questions disabled inside browser workers", async () => {
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
    expect(worker?.defaultTools).toBe(false);
    expect(
      existsSync("agent/subagents/browser-agent/tools/ask_question.ts")
    ).toBe(false);
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

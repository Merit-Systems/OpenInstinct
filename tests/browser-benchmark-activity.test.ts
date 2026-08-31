import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { browserBenchmarkActivity } from "../evals/browser/benchmark-activity";

describe("browser benchmark live activity", () => {
  it("shows the current tool in plain language", () => {
    expect(
      browserBenchmarkActivity([
        {
          data: {
            actions: [
              {
                callId: "call_vault",
                input: {},
                kind: "tool-call",
                toolName: "fill_from_vault",
              },
            ],
            sequence: 0,
            stepIndex: 1,
            turnId: "turn_1",
          },
          meta: { at: "2026-08-31T17:00:00.000Z", id: "evt_vault" },
          type: "actions.requested",
        } satisfies MessageStreamEvent,
      ])
    ).toBe("Securely filling saved user information");
  });

  it("prefers the latest visible progress message", () => {
    expect(
      browserBenchmarkActivity([
        {
          data: {
            modelId: "test/model",
            sequence: 0,
            stepIndex: 0,
            turnId: "turn_1",
          },
          meta: { at: "2026-08-31T17:00:00.000Z", id: "evt_step" },
          type: "step.started",
        } satisfies MessageStreamEvent,
        {
          data: {
            messageDelta: "Searching",
            messageSoFar: "Searching current Brooklyn showtimes",
            sequence: 0,
            stepIndex: 0,
            turnId: "turn_1",
          },
          meta: { at: "2026-08-31T17:00:01.000Z", id: "evt_message" },
          type: "message.appended",
        } satisfies MessageStreamEvent,
      ])
    ).toBe("Searching current Brooklyn showtimes");
  });
});

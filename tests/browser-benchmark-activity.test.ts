import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import {
  browserBenchmarkActivity,
  browserBenchmarkActivityDurations,
  browserBenchmarkLiveViewUrl,
} from "../evals/browser/benchmark-activity";

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

  it("sums wall time by model and browser activity type", () => {
    const events = [
      {
        data: {
          modelId: "test/model",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-31T17:00:00.000Z", id: "evt_step_1" },
        type: "step.started",
      },
      {
        data: {
          actions: [
            {
              callId: "call_playwright",
              input: {},
              kind: "tool-call",
              toolName: "playwright_execute",
            },
          ],
          sequence: 1,
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-31T17:00:01.000Z", id: "evt_action_1" },
        type: "actions.requested",
      },
      {
        data: {
          result: {
            callId: "call_playwright",
            kind: "tool-result",
            output: { ok: true },
            toolName: "playwright_execute",
          },
          sequence: 2,
          status: "completed",
          stepIndex: 0,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-31T17:00:04.000Z", id: "evt_result_1" },
        type: "action.result",
      },
      {
        data: {
          actions: [
            {
              callId: "call_semantic",
              input: {},
              kind: "tool-call",
              toolName: "browser_act",
            },
          ],
          sequence: 3,
          stepIndex: 1,
          turnId: "turn_1",
        },
        meta: { at: "2026-08-31T17:00:07.000Z", id: "evt_action_2" },
        type: "actions.requested",
      },
    ] satisfies MessageStreamEvent[];

    expect(
      browserBenchmarkActivityDurations(
        events,
        Date.parse("2026-08-31T17:00:10.000Z")
      )
    ).toEqual({ model: 4_000, playwright: 3_000, semantic: 3_000 });
  });

  it("finds the Kernel live browser stream from session creation", () => {
    const event = {
      data: {
        result: {
          callId: "call_browser",
          kind: "tool-result",
          output: {
            browser: {
              browser_live_view_url:
                "https://live.kernel.test/browser/session-1",
            },
          },
          toolName: "manage_browsers",
        },
        sequence: 0,
        status: "completed",
        stepIndex: 0,
        turnId: "turn_1",
      },
      meta: { at: "2026-08-31T17:00:00.000Z", id: "evt_browser" },
      type: "action.result",
    } satisfies MessageStreamEvent;

    expect(browserBenchmarkLiveViewUrl([event])).toBe(
      "https://live.kernel.test/browser/session-1"
    );
  });
});

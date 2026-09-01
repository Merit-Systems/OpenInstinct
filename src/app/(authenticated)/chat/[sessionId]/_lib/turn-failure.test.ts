import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { getLatestTurnFailure } from "./turn-failure";

describe("turn failures", () => {
  it("keeps a parked failed child visibly failed", () => {
    const events = [
      {
        data: {
          code: "CHILD_FAILED",
          message: "Child failed.",
          sequence: 1,
          turnId: "child-turn",
        },
        meta: { at: "2026-08-27T20:00:00.000Z", id: "failed" },
        type: "turn.failed",
      },
      {
        data: { continuationToken: "", wait: "next-user-message" },
        meta: { at: "2026-08-27T20:00:01.000Z", id: "waiting" },
        type: "session.waiting",
      },
    ] satisfies MessageStreamEvent[];

    expect(getLatestTurnFailure(events)).toBe("Child failed.");
  });
});

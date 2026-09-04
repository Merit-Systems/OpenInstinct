import { describe, expect, it } from "vitest";
import { computeNextRun } from "@/agent/lib/schedules/timing";
import {
  describeCadence,
  proactionTiming,
} from "@/agent/lib/proactions/timing";

const settings = { briefLocalTime: "07:30", timezone: "America/New_York" };
const now = new Date("2026-09-03T12:00:00.000Z");

describe("proaction timing", () => {
  it("anchors a brief cadence to the user's local brief time", () => {
    const timing = proactionTiming({ kind: "brief" }, settings, now);
    expect(timing).toEqual({
      frequency: "daily",
      kind: "calendar",
      localTime: "07:30",
      timezone: "America/New_York",
    });
    expect(computeNextRun(timing, now)?.toISOString()).toBe(
      "2026-09-04T11:30:00.000Z"
    );
  });

  it("puts a weekly cadence on the requested weekday", () => {
    const timing = proactionTiming(
      { kind: "weekly", weekday: 1 },
      settings,
      now
    );
    expect(timing).toMatchObject({ frequency: "weekly", weekday: 1 });
    expect(computeNextRun(timing, now)?.toISOString()).toBe(
      "2026-09-07T11:30:00.000Z"
    );
  });

  it("anchors an interval cadence at reconcile time", () => {
    expect(
      proactionTiming({ everyMinutes: 360, kind: "interval" }, settings, now)
    ).toEqual({
      anchoredAt: now.toISOString(),
      everyMinutes: 360,
      kind: "interval",
    });
  });

  it("describes each cadence for people", () => {
    expect(describeCadence({ kind: "brief" })).toBe("Daily at your brief time");
    expect(describeCadence({ kind: "weekly", weekday: 5 })).toBe(
      "Weekly on Friday at your brief time"
    );
    expect(describeCadence({ everyMinutes: 360, kind: "interval" })).toBe(
      "Every 6 hours"
    );
  });
});

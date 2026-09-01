import { describe, expect, it } from "vitest";
import {
  automationTriggerSchema,
  gmailTriggerMatches,
  nextAutomationRunAt,
} from "../automation";

describe("automation scheduling", () => {
  it("keeps recurring local time across daylight-saving changes", () => {
    const next = nextAutomationRunAt(
      {
        kind: "recurring",
        localTime: "03:30",
        recurrence: "daily",
      },
      "America/New_York",
      new Date("2026-03-08T06:59:00.000Z")
    );
    expect(next?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(
      nextAutomationRunAt(
        {
          kind: "recurring",
          localTime: "01:30",
          recurrence: "daily",
        },
        "America/New_York",
        new Date("2026-11-01T05:31:00.000Z")
      )?.toISOString()
    ).toBe("2026-11-02T06:30:00.000Z");
  });

  it("resolves weekly and interval triggers after an exclusive cursor", () => {
    expect(
      nextAutomationRunAt(
        {
          kind: "recurring",
          localTime: "09:00",
          recurrence: "weekly",
          weekday: "monday",
        },
        "America/New_York",
        new Date("2026-08-31T13:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-09-07T13:00:00.000Z");
    expect(
      nextAutomationRunAt(
        {
          everyMinutes: 15,
          kind: "interval",
          startsAt: "2026-08-31T12:00:00.000Z",
        },
        "UTC",
        new Date("2026-08-31T12:31:00.000Z")
      )?.toISOString()
    ).toBe("2026-08-31T12:45:00.000Z");
  });

  it("rejects unfiltered Gmail triggers and matches normalized metadata", () => {
    expect(automationTriggerSchema.safeParse({ kind: "gmail" }).success).toBe(
      false
    );
    expect(
      gmailTriggerMatches(
        {
          fromAddress: "ava@example.com",
          kind: "gmail",
          subjectContains: "launch",
        },
        {
          from: "Ava Chen <AVA@example.com>",
          subject: "Re: LAUNCH plan",
          threadId: "thread-1",
        }
      )
    ).toBe(true);
    expect(
      gmailTriggerMatches(
        { fromAddress: "ava@example.com", kind: "gmail" },
        {
          from: '"ava@example.com" <attacker@example.net>',
          subject: "launch",
          threadId: "thread-1",
        }
      )
    ).toBe(false);
  });
});

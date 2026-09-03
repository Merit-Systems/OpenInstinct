import { describe, expect, it } from "vitest";
import { approvalSummary } from "./approval-summary";

describe("approval summary", () => {
  it("names recipients and subject for an email", () => {
    expect(
      approvalSummary({
        input: {
          body: "…",
          cc: ["cc@example.com"],
          subject: "Quarterly report",
          to: ["attacker@evil.invalid"],
        },
        toolName: "gmail-send",
      })
    ).toBe(
      "Send email to attacker@evil.invalid (cc cc@example.com) with subject “Quarterly report”."
    );
  });

  it("names the calendar, start, and attendees for an event", () => {
    expect(
      approvalSummary({
        input: {
          attendees: ["a@example.com", "b@example.com"],
          calendarId: "team",
          end: "2026-09-04T11:00:00Z",
          start: "2026-09-04T10:00:00Z",
          summary: "Sync",
        },
        toolName: "calendar-create-event",
      })
    ).toBe(
      "Create “Sync” on calendar team starting 2026-09-04T10:00:00Z and invite 2 attendees (a@example.com, b@example.com)."
    );
  });

  it("counts messages for a Gmail update", () => {
    expect(
      approvalSummary({
        input: { messageIds: ["m1", "m2"], update: "archive" },
        toolName: "gmail-update",
      })
    ).toBe("Apply “archive” to 2 messages.");
  });

  it("leaves unknown tools and malformed input to the raw parameters", () => {
    expect(
      approvalSummary({ input: { amount: 1 }, toolName: "send_payment" })
    ).toBeUndefined();
    expect(
      approvalSummary({ input: { subject: 1 }, toolName: "gmail-send" })
    ).toBeUndefined();
  });
});

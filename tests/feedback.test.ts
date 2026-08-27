import { describe, expect, it } from "vitest";
import { feedbackIdempotencyKey, normalizeFeedback } from "../lib/feedback";

describe("feedback", () => {
  it("trims feedback and redacts obvious secrets", () => {
    const feedback = normalizeFeedback(
      "  the login exposed code 123456 and card 4242 4242 4242 4242  "
    );

    expect(feedback.startsWith("the login")).toBe(true);
    expect(feedback).not.toMatch(/123456/u);
    expect(feedback).not.toMatch(/4242 4242/u);
  });

  it("rejects empty feedback", () => {
    expect(() => normalizeFeedback("   ")).toThrow(/cannot be empty/iu);
  });

  it("keeps redaction expansion within the database limit", () => {
    const feedback = normalizeFeedback(
      Array.from({ length: 571 }, () => "123456").join(" ")
    );

    expect(feedback.length).toBeLessThanOrEqual(4_000);
    expect(feedback).not.toMatch(/123456/u);
  });

  it("redacts labeled credentials, provider tokens, and private keys", () => {
    const feedback = normalizeFeedback(
      [
        "password=hunter2",
        '"client_secret": "secret-value-123"',
        "api_key=plain-api-key-value",
        "sk-proj-abcdefghijklmnopqrstuv",
        "ghp_abcdefghijklmnopqrstuvwxyz123456",
        "AKIAABCDEFGHIJKLMNOP",
        "-----BEGIN PRIVATE KEY-----\nvery-private\n-----END PRIVATE KEY-----",
      ].join("\n")
    );

    for (const secret of [
      "hunter2",
      "secret-value-123",
      "plain-api-key-value",
      "abcdefghijklmnopqrstuv",
      "abcdefghijklmnopqrstuvwxyz123456",
      "AKIAABCDEFGHIJKLMNOP",
      "very-private",
    ]) {
      expect(feedback).not.toContain(secret);
    }
  });

  it("redacts environment secrets and connection URL credentials", () => {
    const feedback = normalizeFeedback(
      [
        "DATABASE_URL=postgresql://alice:swordfish@example.com/app",
        "cache failed at redis://bob:hunter2@cache.example.com/0",
      ].join("\n")
    );

    expect(feedback).not.toContain("swordfish");
    expect(feedback).not.toContain("hunter2");
    expect(feedback).toContain(
      "redis://bob:[credential redacted]@cache.example.com/0"
    );
  });

  it("binds replay keys to durable content", () => {
    const input = {
      category: "bug" as const,
      feedback: "the browser result was stale",
      sessionId: "session-1",
      turnId: "turn-1",
    };

    expect(feedbackIdempotencyKey(input)).toBe(feedbackIdempotencyKey(input));
    expect(feedbackIdempotencyKey(input)).not.toBe(
      feedbackIdempotencyKey({
        ...input,
        feedback: "the browser timed out",
      })
    );
  });
});

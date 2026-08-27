import { describe, expect, it } from "vitest";
import { accessScopeForUser } from "../lib/access-scope";
import { isFullyAuthenticatedUser } from "../lib/auth-user";
import { sessionIdFromPath } from "../lib/eve-session-path";
import { normalizeAuthPhoneNumber } from "../lib/phone-number";
import { isLocalPhoneAuthBypassEnabled } from "../lib/runtime-env";

describe("multi-user request identity", () => {
  it("derives stable personal workspaces without exposing provider ids", () => {
    const first = accessScopeForUser("better-auth:123");
    const second = accessScopeForUser("better-auth:456");

    expect(first).toEqual(accessScopeForUser("better-auth:123"));
    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(first.workspaceId).not.toContain("better-auth:123");
  });

  it("extracts ownership ids from every Eve session route", () => {
    expect(sessionIdFromPath("/eve/v1/session/session%2Fone/stream")).toBe(
      "session/one"
    );
    expect(sessionIdFromPath("/eve/v1/session/session-two/cancel")).toBe(
      "session-two"
    );
    expect(sessionIdFromPath("/eve/v1/session")).toBeUndefined();
  });

  it("accepts only users with a verified phone number", () => {
    expect(
      isFullyAuthenticatedUser({
        phoneNumber: "+12025550123",
        phoneNumberVerified: true,
      })
    ).toBe(true);
    expect(
      isFullyAuthenticatedUser({
        phoneNumber: "+12025550123",
        phoneNumberVerified: false,
      })
    ).toBe(false);
    expect(
      isFullyAuthenticatedUser({
        phoneNumberVerified: true,
      })
    ).toBe(false);
  });

  it("defaults phone numbers to the +1 country code", () => {
    expect(normalizeAuthPhoneNumber("(202) 555-0123")).toBe("+12025550123");
    expect(normalizeAuthPhoneNumber("1 202 555 0123")).toBe("+12025550123");
    expect(normalizeAuthPhoneNumber("+44 7911 123456")).toBe("+447911123456");
    expect(normalizeAuthPhoneNumber("not-a-number")).toBeUndefined();
  });

  it("bypasses phone OTP only during local development", () => {
    expect(
      isLocalPhoneAuthBypassEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
      })
    ).toBe(true);
    expect(
      isLocalPhoneAuthBypassEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "production",
        VERCEL_ENV: undefined,
      })
    ).toBe(false);
    expect(
      isLocalPhoneAuthBypassEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        VERCEL_ENV: "development",
      })
    ).toBe(false);
    expect(
      isLocalPhoneAuthBypassEnabled({
        BETTER_AUTH_URL: "https://preview.example.com",
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
      })
    ).toBe(false);
    expect(
      isLocalPhoneAuthBypassEnabled({
        BETTER_AUTH_URL: undefined,
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
      })
    ).toBe(false);
  });
});

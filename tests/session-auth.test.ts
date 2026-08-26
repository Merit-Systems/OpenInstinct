import { describe, expect, it } from "vitest";
import { accessScopeForUser } from "../lib/access-scope";
import { isFullyAuthenticatedUser } from "../lib/auth-user";
import { getDeploymentMode } from "../lib/deployment-mode";
import { sessionIdFromPath } from "../lib/eve-session-path";

describe("multi-user request identity", () => {
  it("derives stable personal workspaces without exposing provider ids", () => {
    const first = accessScopeForUser("better-auth:123");
    const second = accessScopeForUser("better-auth:456");

    expect(first).toEqual(accessScopeForUser("better-auth:123"));
    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(first.workspaceId).not.toContain("better-auth:123");
  });

  it("defaults local machines and Vercel deployments safely", () => {
    expect(getDeploymentMode({})).toBe("local");
    expect(getDeploymentMode({ VERCEL: "1" })).toBe("hosted");
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

  it("accepts only phone-verified users with SMS 2FA enabled", () => {
    expect(
      isFullyAuthenticatedUser({
        phoneNumber: "+12025550123",
        phoneNumberVerified: true,
        twoFactorEnabled: true,
      })
    ).toBe(true);
    expect(
      isFullyAuthenticatedUser({
        phoneNumber: "+12025550123",
        phoneNumberVerified: true,
        twoFactorEnabled: false,
      })
    ).toBe(false);
    expect(
      isFullyAuthenticatedUser({
        phoneNumber: "+12025550123",
        phoneNumberVerified: false,
        twoFactorEnabled: true,
      })
    ).toBe(false);
  });
});

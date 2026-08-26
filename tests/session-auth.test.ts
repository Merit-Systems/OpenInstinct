import { describe, expect, it } from "vitest";
import { accessScopeForUser } from "../lib/access-scope";
import { getDeploymentMode } from "../lib/deployment-mode";
import { sessionIdFromPath } from "../lib/eve-session-path";

describe("multi-user request identity", () => {
  it("derives stable personal workspaces without exposing provider ids", () => {
    const first = accessScopeForUser("github:123");
    const second = accessScopeForUser("github:456");

    expect(first).toEqual(accessScopeForUser("github:123"));
    expect(first.workspaceId).not.toBe(second.workspaceId);
    expect(first.workspaceId).not.toContain("github:123");
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
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSession = vi.fn<(headers: Headers) => Promise<undefined>>();

vi.mock("@/auth/session", () => ({ getAuthSession }));

describe("application proxy", () => {
  beforeEach(() => {
    getAuthSession.mockReset();
    getAuthSession.mockResolvedValue(undefined);
  });

  it("passes self-authenticating automation webhooks to their route handlers", async () => {
    const { proxy } = await import("../src/proxy");
    const responses = await Promise.all(
      ["/api/automations/arm", "/api/automations/gmail"].map(
        async (pathname) =>
          await proxy(new NextRequest(new URL(pathname, "https://example.com")))
      )
    );
    for (const response of responses) {
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("passes signed automation session requests but still protects ordinary sessions", async () => {
    const { proxy } = await import("../src/proxy");
    const createPath = "/eve/v1/session";
    const path = "/eve/v1/session/session-1/stream";
    const createResponse = await proxy(
      new NextRequest(new URL(createPath, "https://example.com"), {
        headers: { "x-openinstinct-automation-purpose": "execute" },
      })
    );
    const automationResponse = await proxy(
      new NextRequest(new URL(path, "https://example.com"), {
        headers: { "x-openinstinct-automation-purpose": "execute" },
      })
    );
    const ordinaryResponse = await proxy(
      new NextRequest(new URL(path, "https://example.com"))
    );
    expect(createResponse.headers.get("x-middleware-next")).toBe("1");
    expect(automationResponse.headers.get("x-middleware-next")).toBe("1");
    expect(ordinaryResponse.status).toBe(307);
    expect(ordinaryResponse.headers.get("location")).toBe(
      "https://example.com/sign-in?callbackUrl=%2Feve%2Fv1%2Fsession%2Fsession-1%2Fstream"
    );
  });
});

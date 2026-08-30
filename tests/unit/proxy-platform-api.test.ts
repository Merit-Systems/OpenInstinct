import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/auth/session");
  vi.resetModules();
});

it("does not redirect unauthenticated /v1 requests", async () => {
  vi.doMock("@/auth/session", () => ({
    getAuthSession: vi.fn<() => Promise<undefined>>(),
  }));
  const { proxy } = await import("@/proxy");
  const response = await proxy(new NextRequest("http://test/v1/agents"));
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

it("does not redirect unauthenticated /api/cron requests", async () => {
  vi.doMock("@/auth/session", () => ({
    getAuthSession: vi.fn<() => Promise<undefined>>(),
  }));
  const { proxy } = await import("@/proxy");
  const response = await proxy(
    new NextRequest("http://test/api/cron/drain-webhooks")
  );
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { createProxy } from "@/proxy";
import type { proxyDependencies } from "@/proxy";

const getAuthSession = vi.fn<typeof proxyDependencies.getAuthSession>();
const proxy = createProxy({ getAuthSession });

it("does not redirect unauthenticated /v1 requests", async () => {
  const response = await proxy(new NextRequest("http://test/v1/agents"));
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(getAuthSession).not.toHaveBeenCalled();
});

it("does not redirect unauthenticated /api/cron requests", async () => {
  const response = await proxy(
    new NextRequest("http://test/api/cron/drain-webhooks")
  );
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(getAuthSession).not.toHaveBeenCalled();
});

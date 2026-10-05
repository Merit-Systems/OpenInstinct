import type { env as environment } from "@shared/environment";
import type { routeAuth, vercelOidc } from "eve/channels/auth";
import type { getInstallationSecrets } from "@db/services/installation-secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let vercelEnvironment: typeof environment.VERCEL_ENV;
  return {
    env: {
      get VERCEL_ENV() {
        return vercelEnvironment;
      },
    },
    setEnvironment(value: typeof environment.VERCEL_ENV) {
      vercelEnvironment = value;
    },
    routeAuth: vi.fn<typeof routeAuth>(),
  };
});

vi.mock("@shared/environment", () => ({ env: mocks.env }));
vi.mock("@db/services/installation-secrets", () => ({
  getInstallationSecrets: vi
    .fn<typeof getInstallationSecrets>()
    .mockResolvedValue({
      betterAuthSecret: "test-auth-secret-0123456789abcdefghijklmnop",
      secretEncryptionKey: "test-key",
      version: 1,
    }),
}));
vi.mock("eve/channels/auth", () => ({
  routeAuth: mocks.routeAuth,
  vercelOidc: vi.fn<typeof vercelOidc>().mockReturnValue(async () => null),
}));

import {
  authorizeScheduledRequest,
  signScheduledRequest,
} from "@db/services/auth/scheduled-requests";

describe("scheduled request authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setEnvironment(undefined);
  });

  it("binds a self-hosted signature to the request body and route", async () => {
    const path = "/internal/scheduled-run/command";
    const body = JSON.stringify({ kind: "backfill" });
    const headers = await signScheduledRequest(path, body);
    expect(
      await authorizeScheduledRequest(
        new Request("https://example.com" + path, {
          method: "POST",
          body,
          headers,
        })
      )
    ).toBeUndefined();
    expect(
      (
        await authorizeScheduledRequest(
          new Request("https://example.com" + path, {
            method: "POST",
            body: "{}",
            headers,
          })
        )
      )?.status
    ).toBe(401);
    expect(
      (
        await authorizeScheduledRequest(
          new Request("https://example.com/internal/scheduled-run/wake", {
            method: "POST",
            body,
            headers,
          })
        )
      )?.status
    ).toBe(401);
    expect(
      (
        await authorizeScheduledRequest(
          new Request("https://example.com" + path, {
            method: "POST",
            body,
            headers: { ...headers, "x-openinstinct-schedule-time": "0" },
          })
        )
      )?.status
    ).toBe(401);
    expect(mocks.routeAuth).not.toHaveBeenCalled();
  });

  it("accepts only runtime principals on Vercel, without a signature fallback", async () => {
    mocks.setEnvironment("production");
    const request = new Request("https://example.com/api/scheduled-wakeups", {
      method: "POST",
      body: "{}",
    });
    mocks.routeAuth.mockResolvedValue({
      authenticator: "vercel-oidc",
      principalType: "user",
      principalId: "other-user",
      attributes: {},
    });
    expect((await authorizeScheduledRequest(request))?.status).toBe(403);
    mocks.routeAuth.mockResolvedValue({
      authenticator: "vercel-oidc",
      principalType: "runtime",
      principalId: "eve:app",
      attributes: {},
    });
    expect(await authorizeScheduledRequest(request)).toBeUndefined();
    mocks.routeAuth.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await authorizeScheduledRequest(request))?.status).toBe(401);
  });
});

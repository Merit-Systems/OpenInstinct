import type { getVercelOidcToken } from "@vercel/oidc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestEnvironment {
  VERCEL_ENV: "development" | "preview" | "production" | undefined;
  VERCEL_URL: string | undefined;
}

const mocks = vi.hoisted(() => {
  const env: TestEnvironment = {
    VERCEL_ENV: undefined,
    VERCEL_URL: undefined,
  };
  return { env, getToken: vi.fn<typeof getVercelOidcToken>() };
});

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: mocks.getToken }));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/application-origin", () => ({
  applicationOrigin: () => "https://example.com",
}));

import { postScheduledReport } from "@/agent/lib/schedules/request";

describe("scheduled report requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    mocks.env.VERCEL_ENV = undefined;
    mocks.env.VERCEL_URL = undefined;
    mocks.getToken.mockResolvedValue("vercel-oidc-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates Vercel callbacks with the deployment OIDC token", async () => {
    mocks.env.VERCEL_ENV = "preview";
    mocks.env.VERCEL_URL = "openinstinct-preview.vercel.app";

    await postScheduledReport("run-1");

    expect(mocks.getToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        "https://openinstinct-preview.vercel.app/internal/scheduled-run/report"
      ),
      expect.objectContaining({
        body: JSON.stringify({ runId: "run-1" }),
        method: "POST",
        redirect: "error",
      })
    );
    expect(sentHeaders().get("authorization")).toBe("Bearer vercel-oidc-token");
    expect(sentHeaders().get("x-vercel-trusted-oidc-idp-token")).toBe(
      "vercel-oidc-token"
    );
  });

  it("leaves local callbacks to Eve local development authentication", async () => {
    await postScheduledReport("run-1");

    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/internal/scheduled-run/report"),
      expect.objectContaining({ method: "POST", redirect: "error" })
    );
    expect(sentHeaders().get("authorization")).toBeNull();
  });
});

function sentHeaders() {
  const call = vi.mocked(fetch).mock.calls[0];
  if (!call) throw new Error("No scheduled report request was sent.");
  return new Headers(call[1]?.headers);
}

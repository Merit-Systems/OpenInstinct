import type { readFile } from "node:fs/promises";
import type { getVercelOidcToken } from "@vercel/oidc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestEnvironment {
  NODE_ENV: "development" | "production" | "test";
  VERCEL_ENV: "development" | "preview" | "production" | undefined;
  VERCEL_URL: string | undefined;
}

const mocks = vi.hoisted(() => {
  const env: TestEnvironment = {
    NODE_ENV: "development",
    VERCEL_ENV: undefined,
    VERCEL_URL: undefined,
  };
  return {
    env,
    getToken: vi.fn<typeof getVercelOidcToken>(),
    readFile: vi.fn<typeof readFile>(),
  };
});

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: mocks.getToken }));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/application-origin", () => ({
  applicationOrigin: () => "https://example.com",
}));

import { postScheduledRunRoute } from "@/agent/lib/schedules/request";

describe("scheduled run requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    mocks.env.NODE_ENV = "development";
    mocks.env.VERCEL_ENV = undefined;
    mocks.env.VERCEL_URL = undefined;
    mocks.getToken.mockResolvedValue("vercel-oidc-token");
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        appRoot: process.cwd(),
        origin: "http://127.0.0.1:51829",
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates Vercel callbacks with the deployment OIDC token", async () => {
    mocks.env.VERCEL_ENV = "preview";
    mocks.env.VERCEL_URL = "openinstinct-preview.vercel.app";

    await postScheduledRunRoute("/internal/scheduled-run/report", {
      runId: "run-1",
    });

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
    expect(sentHeaders().get("content-type")).toBe("application/json");
    expect(sentHeaders().get("x-vercel-trusted-oidc-idp-token")).toBe(
      "vercel-oidc-token"
    );
  });

  it("leaves local callbacks to Eve local development authentication", async () => {
    await postScheduledRunRoute("/internal/scheduled-run/start", {
      leaseToken: "lease-1",
      restart: false,
      runId: "run-1",
    });

    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:51829/internal/scheduled-run/start"),
      expect.objectContaining({ method: "POST", redirect: "error" })
    );
    expect(sentHeaders().get("authorization")).toBeNull();
    expect(sentHeaders().get("content-type")).toBe("application/json");
    expect(sentHeaders().get("x-vercel-trusted-oidc-idp-token")).toBeNull();
  });

  it("falls back to the application origin outside Next development", async () => {
    mocks.env.NODE_ENV = "test";

    await postScheduledRunRoute("/internal/scheduled-run/report", {
      runId: "run-1",
    });

    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/internal/scheduled-run/report"),
      expect.objectContaining({ method: "POST", redirect: "error" })
    );
  });

  it("ignores a development registry owned by another checkout", async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        appRoot: "/tmp/another-checkout",
        origin: "http://127.0.0.1:51829",
      })
    );

    await postScheduledRunRoute("/internal/scheduled-run/report", {
      runId: "run-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/internal/scheduled-run/report"),
      expect.objectContaining({ method: "POST", redirect: "error" })
    );
  });
});

function sentHeaders() {
  const call = vi.mocked(fetch).mock.calls[0];
  if (!call) throw new Error("No scheduled run request was sent.");
  return new Headers(call[1]?.headers);
}

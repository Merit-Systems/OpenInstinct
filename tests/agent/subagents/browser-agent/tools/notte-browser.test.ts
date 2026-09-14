import { z } from "zod";
import type { AccessScope } from "@shared/identity/access-scope";
import { harvestBrowserTraceDomains } from "@agent/subagents/browser-agent/lib/trace/domains";
/* oxlint-disable vitest/require-mock-type-parameters -- Fixtures mock the external service boundaries exercised here. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolContextFor } from "@tests/helpers/tool-context";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  owned: vi.fn(),
  execute: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@shared/environment", () => ({
  env: { BROWSER_PROVIDER: "notte", NOTTE_API_KEY: "test-notte-key" },
}));
vi.mock("@db/services/browsers", () => ({
  createBrowserSession: mocks.create,
  deleteBrowserSession: mocks.remove,
  listBrowserSessions: mocks.list,
  withBrowserProfileWriteLock: <T>(
    _scope: AccessScope,
    operation: () => Promise<T>
  ) => operation(),
}));
vi.mock("@db/services/browser-traces", () => ({
  recordBrowserTraceDomains: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@agent/subagents/browser-agent/lib/access", () => ({
  requireWorkerScope: () => ({ workspaceId: "workspace-1", userId: "user-1" }),
}));
vi.mock("@agent/subagents/browser-agent/lib/owned-browser", () => ({
  requireOwnedBrowserSession: mocks.owned,
}));
vi.mock("@agent/subagents/browser-agent/lib/semantic-loop", () => ({
  disposeBrowserLoopSession: vi.fn(),
}));
vi.mock("@onkernel/browser-loop", () => ({
  BrowserExecutor: class {
    execute = mocks.execute;
    close = mocks.close;
  },
}));
import manageBrowsers from "@agent/subagents/browser-agent/tools/manage_browsers";
import { notteCdpUrl } from "@agent/subagents/browser-agent/lib/notte";
import { kernel } from "@agent/subagents/browser-agent/lib/kernel";

const session = {
  session_id: "remote-id",
  created_at: "2026-09-01T00:00:00Z",
  status: "active",
  cdp_url: "wss://cdp.notte.test/session?token=secret",
  viewer_url: "https://viewer.notte.test/session",
};
function json(value: z.infer<ReturnType<typeof z.json>>, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function startResponses() {
  mocks.fetch.mockResolvedValueOnce(
    json({ items: [{ name: null, profile_id: "unrelated" }] })
  );
  mocks.fetch.mockResolvedValueOnce(
    json({ profile_id: "profile-1", name: null })
  );
  mocks.fetch.mockResolvedValueOnce(json(session));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue(undefined);
  mocks.owned.mockResolvedValue({ sessionId: "notte:read:remote-id" });
});

describe("Notte browser lifecycle", () => {
  it("creates a persistent workspace session without calling Kernel or exposing CDP credentials", async () => {
    const kernelCreate = vi.spyOn(kernel.browsers, "create");
    startResponses();
    const result = await manageBrowsers.execute(
      { action: "create", save_changes: true },
      toolContextFor()
    );
    expect(result).toMatchObject({
      browser: {
        session_id: "notte:write:remote-id",
        browser_live_view_url: session.viewer_url,
      },
    });
    expect(JSON.stringify(result)).not.toContain("token=secret");
    const body = z
      .json()
      .parse(
        JSON.parse(z.string().parse(mocks.fetch.mock.calls[2]?.[1]?.body))
      );
    expect(body).toMatchObject({
      profile: { id: "profile-1", persist: true },
      proxies: false,
      idle_timeout_minutes: 15,
      max_duration_minutes: 15,
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: "notte:write:remote-id" })
    );
    expect(kernelCreate).not.toHaveBeenCalled();
  });

  it("cleans up a created session if database persistence fails, independently of cancellation", async () => {
    startResponses();
    mocks.fetch.mockResolvedValueOnce(json(session));
    mocks.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      manageBrowsers.execute({ action: "create" }, toolContextFor())
    ).rejects.toThrow("database unavailable");
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "https://api.notte.cc/sessions/remote-id/stop",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("navigates through CDP and closes the connection before recording a session", async () => {
    startResponses();
    mocks.fetch.mockResolvedValueOnce(json(session));
    await manageBrowsers.execute(
      { action: "create", start_url: "https://example.com" },
      toolContextFor()
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      { type: "browser_navigate", url: "https://example.com" },
      expect.anything()
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("blocks a second active profile writer", async () => {
    mocks.list.mockResolvedValue([{ sessionId: "notte:write:existing" }]);
    mocks.fetch.mockResolvedValueOnce(
      json({ ...session, session_id: "existing" })
    );
    await expect(
      manageBrowsers.execute(
        { action: "create", save_changes: true },
        toolContextFor()
      )
    ).rejects.toThrow("Another Notte browser");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lists only owned Notte sessions and retains Kernel records", async () => {
    mocks.list.mockResolvedValue([
      { sessionId: "kernel-id" },
      { sessionId: "notte:read:remote-id" },
    ]);
    mocks.fetch.mockResolvedValueOnce(json(session));
    const result = await manageBrowsers.execute(
      { action: "list" },
      toolContextFor()
    );
    expect(result).toMatchObject({
      items: [{ session_id: "notte:read:remote-id" }],
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("checks ownership before contacting Notte", async () => {
    mocks.owned.mockRejectedValueOnce(new Error("not owned"));
    await expect(
      manageBrowsers.execute(
        { action: "get", session_id: "notte:read:remote-id" },
        toolContextFor()
      )
    ).rejects.toThrow("not owned");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("tolerates an already removed remote session during deletion", async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 404));
    await manageBrowsers.execute(
      { action: "delete", session_id: "notte:read:remote-id" },
      toolContextFor()
    );
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.anything(),
      "notte:read:remote-id"
    );
  });

  it("does not remove local records on transient provider failure", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ detail: "sensitive" }, 503));
    await expect(
      manageBrowsers.execute(
        { action: "delete", session_id: "notte:read:remote-id" },
        toolContextFor()
      )
    ).rejects.toThrow("HTTP 503");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not contact Kernel telemetry for Notte sessions", async () => {
    const telemetry = vi.spyOn(kernel.browsers.telemetry, "events");
    await harvestBrowserTraceDomains(
      { workspaceId: "workspace-1", userId: "user-1" },
      "trace-1",
      { sessionId: "notte:read:remote-id", createdAt: session.created_at }
    );
    expect(telemetry).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("falls back to authenticated debug discovery if status omits CDP", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ ...session, cdp_url: null }));
    mocks.fetch.mockResolvedValueOnce(json({ ws: { cdp: session.cdp_url } }));
    expect(await notteCdpUrl("notte:read:remote-id")).toBe(session.cdp_url);
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "https://api.notte.cc/sessions/remote-id/debug",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-notte-key",
          "Content-Type": "application/json",
        },
      })
    );
  });
});

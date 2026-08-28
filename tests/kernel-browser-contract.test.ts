import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import manageBrowsers from "../agent/subagents/coordinator/subagents/browser/tools/manage_browsers";

const mocks = vi.hoisted(() => ({
  createBrowser: vi.fn<
    (
      _input: unknown,
      _options: unknown
    ) => Promise<{
      browser_live_view_url: string;
      created_at: string;
      deleted_at: null;
      session_id: string;
      viewport: null;
    }>
  >(),
  createBrowserSession:
    vi.fn<(_scope: unknown, _record: unknown) => Promise<void>>(),
  deleteBrowserSession:
    vi.fn<(_scope: unknown, _sessionId: string) => Promise<boolean>>(),
  listBrowserSessions:
    vi.fn<() => Promise<{ createdAt: string; sessionId: string }[]>>(),
  retrieveBrowser: vi.fn<() => Promise<never>>(),
  requireWorkerScope: vi.fn<(_context: unknown) => Promise<unknown>>(),
}));

vi.mock("@/agent/subagents/coordinator/subagents/browser/lib/access", () => ({
  requireWorkerScope: mocks.requireWorkerScope,
}));

vi.mock("@/db/services/browsers", () => ({
  createBrowserSession: mocks.createBrowserSession,
  deleteBrowserSession: mocks.deleteBrowserSession,
  listBrowserSessions: mocks.listBrowserSessions,
}));

vi.mock("@/lib/kernel", () => ({
  kernel: {
    browsers: {
      create: mocks.createBrowser,
      retrieve: mocks.retrieveBrowser,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.createBrowser.mockResolvedValue({
    browser_live_view_url: "https://live.kernel.test/browser-1",
    created_at: "2026-08-27T00:00:00.000Z",
    deleted_at: null,
    session_id: "browser-1",
    viewport: null,
  });
  mocks.deleteBrowserSession.mockResolvedValue(true);
  mocks.listBrowserSessions.mockResolvedValue([]);
});

describe("Kernel browser contract", () => {
  it("keeps agent-created browsers alive for at least 15 minutes", () => {
    const inputSchema = manageBrowsers.inputSchema;
    if (!(inputSchema instanceof z.ZodType)) {
      throw new Error("manage_browsers must use a Zod input schema.");
    }

    expect(
      inputSchema.safeParse({
        action: "create",
        timeout_seconds: 120,
      }).success
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        action: "create",
        timeout_seconds: 900,
      }).success
    ).toBe(true);
  });

  it("starts at the target URL and returns the live-view URL", async () => {
    const execute = manageBrowsers.execute;

    const result = await execute(
      { action: "create", start_url: "https://example.com/checkout" },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool context is external Eve runtime state; create only reads abortSignal after the mocked authorization boundary.
      {} as never
    );
    expect(result).toMatchObject({
      browser: {
        browser_live_view_url: "https://live.kernel.test/browser-1",
      },
    });

    expect(mocks.createBrowser).toHaveBeenCalledExactlyOnceWith(
      {
        start_url: "https://example.com/checkout",
        stealth: true,
        timeout_seconds: 900,
        viewport: undefined,
      },
      { signal: undefined }
    );
  });

  it("prunes stale owned records when Kernel reports a missing browser", async () => {
    mocks.listBrowserSessions.mockResolvedValue([
      {
        createdAt: "2026-08-27T00:00:00.000Z",
        sessionId: "stale-browser",
      },
    ]);
    mocks.retrieveBrowser.mockRejectedValue({ status: 404 });

    const execute = manageBrowsers.execute;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool context is external Eve runtime state; list only reads authorization through the mocked boundary.
    const result = await execute({ action: "list" }, {} as never);

    expect(result).toEqual({ has_more: false, items: [], next_offset: null });
    expect(mocks.deleteBrowserSession).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      "stale-browser"
    );
  });
});

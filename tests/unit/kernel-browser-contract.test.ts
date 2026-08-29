import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  createBrowser: vi.fn<(...arguments_: unknown[]) => Promise<unknown>>(),
  createBrowserSession:
    vi.fn<(_scope: unknown, _record: unknown) => Promise<void>>(),
  deleteBrowser: vi.fn<(...arguments_: unknown[]) => Promise<void>>(),
  deleteBrowserSession:
    vi.fn<(_scope: unknown, _sessionId: string) => Promise<boolean>>(),
  listBrowserSessions:
    vi.fn<() => Promise<{ createdAt: string; sessionId: string }[]>>(),
  listKernelBrowsers:
    vi.fn<(...arguments_: unknown[]) => AsyncIterable<unknown>>(),
  retrieveBrowser: vi.fn<(...arguments_: unknown[]) => Promise<unknown>>(),
  retrieveProfile: vi.fn<(...arguments_: unknown[]) => Promise<unknown>>(),
  requireWorkerScope: vi.fn<(_context: unknown) => Promise<unknown>>(),
  withBrowserProfileWriteLock:
    vi.fn<
      (_scope: unknown, operation: () => Promise<unknown>) => Promise<unknown>
    >(),
}));

vi.mock("@/agent/subagents/worker/lib/access", () => ({
  requireWorkerScope: mocks.requireWorkerScope,
}));

vi.mock("@/db/services/browsers", () => ({
  createBrowserSession: mocks.createBrowserSession,
  deleteBrowserSession: mocks.deleteBrowserSession,
  listBrowserSessions: mocks.listBrowserSessions,
  withBrowserProfileWriteLock: mocks.withBrowserProfileWriteLock,
}));

vi.mock("@/lib/kernel", () => ({
  kernel: {
    browsers: {
      create: mocks.createBrowser,
      deleteByID: mocks.deleteBrowser,
      list: mocks.listKernelBrowsers,
      retrieve: mocks.retrieveBrowser,
    },
    profiles: {
      retrieve: mocks.retrieveProfile,
    },
  },
}));

import manageBrowsers, {
  kernelProfileNameForWorkspace,
} from "../../agent/subagents/worker/tools/manage_browsers";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.retrieveProfile.mockResolvedValue({
    id: "profile-1",
    name: "opaque-profile",
  });
  mocks.listKernelBrowsers.mockReturnValue(asyncItems([]));
  mocks.createBrowser.mockResolvedValue({
    browser_live_view_url: "https://live.kernel.test/browser-1",
    created_at: "2026-08-27T00:00:00.000Z",
    deleted_at: null,
    profile: { id: "profile-1" },
    profile_save_changes: false,
    session_id: "browser-1",
    viewport: null,
  });
  mocks.deleteBrowser.mockResolvedValue();
  mocks.deleteBrowserSession.mockResolvedValue(true);
  mocks.listBrowserSessions.mockResolvedValue([]);
  mocks.withBrowserProfileWriteLock.mockImplementation(
    async (_scope, operation) => operation()
  );
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

  it("starts a read-only persistent-profile browser at the target URL", async () => {
    const result = await manageBrowsers.execute(
      { action: "create", start_url: "https://example.com/checkout" },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool context is external Eve runtime state; create reads only the mocked authorization boundary and abort signal.
      {} as never
    );

    expect(result).toMatchObject({
      browser: {
        browser_live_view_url: "https://live.kernel.test/browser-1",
      },
    });
    expect(mocks.createBrowser).toHaveBeenCalledExactlyOnceWith(
      {
        profile: { id: "profile-1", save_changes: false },
        start_url: "https://example.com/checkout",
        stealth: true,
        timeout_seconds: 900,
        viewport: undefined,
      },
      { signal: undefined }
    );
    expect(mocks.withBrowserProfileWriteLock).not.toHaveBeenCalled();
  });

  it("allows only one writable profile browser", async () => {
    mocks.listKernelBrowsers.mockReturnValue(
      asyncItems([
        {
          profile: { id: "profile-1" },
          profile_save_changes: true,
          session_id: "browser-active",
        },
      ])
    );

    await expect(
      manageBrowsers.execute(
        { action: "create", save_changes: true },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool context is external Eve runtime state; create reads only the mocked authorization boundary and abort signal.
        {} as never
      )
    ).rejects.toThrow(/browser-active.*saving login state/i);
    expect(mocks.withBrowserProfileWriteLock).toHaveBeenCalledOnce();
    expect(mocks.createBrowser).not.toHaveBeenCalled();
  });

  it("prunes stale owned records when Kernel reports a missing browser", async () => {
    mocks.listBrowserSessions.mockResolvedValue([
      {
        createdAt: "2026-08-27T00:00:00.000Z",
        sessionId: "stale-browser",
      },
    ]);
    mocks.retrieveBrowser.mockRejectedValue({ status: 404 });

    const result = await manageBrowsers.execute(
      { action: "list" },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tool context is external Eve runtime state; list reads authorization through the mocked boundary.
      {} as never
    );

    expect(result).toEqual({ has_more: false, items: [], next_offset: null });
    expect(mocks.deleteBrowserSession).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      "stale-browser"
    );
  });

  it("derives opaque, stable, workspace-specific profile names", () => {
    const workspace = "personal:+15555550123";
    const profileName = kernelProfileNameForWorkspace(workspace);

    expect(profileName).toBe(kernelProfileNameForWorkspace(workspace));
    expect(profileName).toMatch(/^openinstinct-[a-f0-9]{40}$/);
    expect(profileName).not.toContain("15555550123");
    expect(profileName).not.toBe(
      kernelProfileNameForWorkspace("personal:+15555550124")
    );
  });
});

function asyncItems<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

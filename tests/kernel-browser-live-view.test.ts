import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "../lib/access-scope";

const mocks = vi.hoisted(() => ({
  readBrowserSession:
    vi.fn<
      () =>
        | Promise<{ createdAt: string; sessionId: string }>
        | Promise<undefined>
    >(),
  retrieve: vi.fn<
    () => Promise<{
      browser_live_view_url?: string;
      deleted_at?: null;
      session_id: string;
      stealth?: boolean;
      viewport?: { height: number; width: number };
    }>
  >(),
}));

vi.mock("@onkernel/sdk", () => ({
  default: class {
    readonly browsers = { retrieve: mocks.retrieve };
  },
}));

vi.mock("@/db/services/browsers", () => ({
  createBrowserSession: vi.fn<() => Promise<void>>(),
  deleteBrowserSession: vi.fn<() => Promise<void>>(),
  listBrowserSessions: vi.fn<() => Promise<never[]>>(),
  readBrowserSession: mocks.readBrowserSession,
}));

import { getOwnedKernelBrowserLiveView } from "../agent/extensions/kernel/browser-live-view";
import { manageOwnedKernelBrowsers } from "../agent/extensions/kernel/browser-runtime";

const scope: AccessScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readBrowserSession.mockResolvedValue({
    createdAt: "2026-08-27T00:00:00.000Z",
    sessionId: "browser-1",
  });
  mocks.retrieve.mockResolvedValue({
    browser_live_view_url: "https://live.kernel.example/signed",
    session_id: "browser-1",
  });
});

describe("Kernel browser live view", () => {
  it("checks ownership before returning the signed URL", async () => {
    await expect(
      getOwnedKernelBrowserLiveView(scope, "browser-1")
    ).resolves.toEqual({
      browser_live_view_url: "https://live.kernel.example/signed",
      session_id: "browser-1",
    });

    expect(mocks.readBrowserSession).toHaveBeenCalledWith(scope, "browser-1");
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "browser-1",
      {},
      {
        signal: undefined,
      }
    );
  });

  it("keeps the signed URL out of ordinary browser retrieval", async () => {
    const browser = await manageOwnedKernelBrowsers(scope, {
      action: "get",
      session_id: "browser-1",
    });

    expect(browser).not.toHaveProperty("browser_live_view_url");
  });

  it("does not retrieve a browser outside the caller's scope", async () => {
    mocks.readBrowserSession.mockResolvedValueOnce(undefined);

    await expect(
      getOwnedKernelBrowserLiveView(scope, "browser-2")
    ).rejects.toThrow("Browser session not found.");
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("fails without returning an empty live-view URL", async () => {
    mocks.retrieve.mockResolvedValueOnce({ session_id: "browser-1" });

    await expect(
      getOwnedKernelBrowserLiveView(scope, "browser-1")
    ).rejects.toThrow("The browser live view is unavailable.");
  });
});

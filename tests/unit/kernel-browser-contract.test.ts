import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { kernel } from "@/lib/kernel";
import { toolContextFor } from "../helpers/tool-context";
import manageBrowsers, {
  createManageBrowsers,
  kernelProfileNameForWorkspace,
  manageBrowsersDependencies,
} from "../../agent/subagents/worker/tools/manage_browsers";

type ListKernelBrowsers = NonNullable<
  Parameters<typeof createManageBrowsers>[0]
>["listKernelBrowsers"];

const mocks = {
  createBrowser: vi.spyOn(kernel.browsers, "create"),
  createBrowserSession: vi.spyOn(
    manageBrowsersDependencies,
    "createBrowserSession"
  ),
  deleteBrowser: vi.spyOn(kernel.browsers, "deleteByID"),
  deleteBrowserSession: vi.spyOn(
    manageBrowsersDependencies,
    "deleteBrowserSession"
  ),
  harvestBrowserTraceDomains: vi.spyOn(
    manageBrowsersDependencies,
    "harvestBrowserTraceDomains"
  ),
  listBrowserSessions: vi.spyOn(
    manageBrowsersDependencies,
    "listBrowserSessions"
  ),
  listKernelBrowsers: vi.fn<ListKernelBrowsers>(),
  readBrowserSession: vi.spyOn(
    manageBrowsersDependencies,
    "requireOwnedBrowserSession"
  ),
  recordBrowserTraceDomains: vi.spyOn(
    manageBrowsersDependencies,
    "recordBrowserTraceDomains"
  ),
  retrieveBrowser: vi.spyOn(kernel.browsers, "retrieve"),
  retrieveProfile: vi.spyOn(kernel.profiles, "retrieve"),
  requireWorkerScope: vi.spyOn(
    manageBrowsersDependencies,
    "requireWorkerScope"
  ),
  withBrowserProfileWriteLock: vi.spyOn(
    manageBrowsersDependencies,
    "withBrowserProfileWriteLock"
  ),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.retrieveProfile.mockResolvedValue({
    created_at: "2026-08-27T00:00:00.000Z",
    id: "profile-1",
    name: "opaque-profile",
  });
  mocks.listKernelBrowsers.mockReturnValue(asyncItems([]));
  mocks.createBrowser.mockResolvedValue({
    browser_live_view_url: "https://live.kernel.test/browser-1",
    cdp_ws_url: "wss://kernel.test/cdp",
    created_at: "2026-08-27T00:00:00.000Z",
    headless: false,
    memory: "2GiB",
    profile: {
      created_at: "2026-08-27T00:00:00.000Z",
      id: "profile-1",
    },
    profile_save_changes: false,
    region: "us-east",
    session_id: "browser-1",
    stealth: true,
    timeout_seconds: 900,
    webdriver_ws_url: "wss://kernel.test/webdriver",
  });
  mocks.deleteBrowser.mockResolvedValue();
  mocks.createBrowserSession.mockResolvedValue();
  mocks.deleteBrowserSession.mockResolvedValue(true);
  mocks.harvestBrowserTraceDomains.mockResolvedValue();
  mocks.listBrowserSessions.mockResolvedValue([]);
  mocks.readBrowserSession.mockResolvedValue({
    createdAt: "2026-08-27T00:00:00.000Z",
    sessionId: "browser-1",
    workerSessionId: "worker-session-1",
  });
  mocks.recordBrowserTraceDomains.mockResolvedValue();
  mocks.withBrowserProfileWriteLock.mockImplementation(
    async (_scope, operation) => operation()
  );
});

const workerContext = toolContextFor({ sessionId: "worker-session-1" });

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
      workerContext
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
        telemetry: { browser: { page: { enabled: true } }, enabled: true },
        timeout_seconds: 900,
        viewport: undefined,
      },
      { signal: workerContext.abortSignal }
    );
    expect(mocks.createBrowserSession).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      {
        createdAt: "2026-08-27T00:00:00.000Z",
        sessionId: "browser-1",
        workerSessionId: "worker-session-1",
      }
    );
    expect(mocks.recordBrowserTraceDomains).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      "worker-session-1",
      ["example.com"]
    );
    expect(mocks.withBrowserProfileWriteLock).not.toHaveBeenCalled();
  });

  it("harvests visited domains from Kernel telemetry before deleting a browser", async () => {
    mocks.readBrowserSession.mockResolvedValue({
      createdAt: "2026-08-27T00:00:00.000Z",
      sessionId: "browser-1",
      workerSessionId: "worker-session-9",
    });

    const result = await manageBrowsers.execute(
      { action: "delete", session_id: "browser-1" },
      workerContext
    );

    expect(result).toBe("Browser session deleted successfully");
    expect(mocks.harvestBrowserTraceDomains).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      "worker-session-9",
      { createdAt: "2026-08-27T00:00:00.000Z", sessionId: "browser-1" },
      expect.any(AbortSignal)
    );
    expect(
      mocks.harvestBrowserTraceDomains.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.deleteBrowser.mock.invocationCallOrder[0] ?? 0);
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
    const tool = createManageBrowsers({
      listKernelBrowsers: mocks.listKernelBrowsers,
    });

    await expect(
      tool.execute({ action: "create", save_changes: true }, toolContextFor())
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
      toolContextFor()
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

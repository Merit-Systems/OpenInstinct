import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@/lib/access-scope";

const mocks = vi.hoisted(() => ({
  applyManagerMutation:
    vi.fn<(scope: AccessScope, input: unknown) => Promise<unknown>>(),
  disconnectGoogleWorkspace: vi.fn<(scope: AccessScope) => Promise<void>>(),
  readModelCatalog: vi.fn<() => Promise<unknown[]>>(),
  readTaskHistoryPage:
    vi.fn<
      (
        scope: AccessScope,
        cursor?: string
      ) => Promise<{ cursor: string | null; hasMore: boolean; runs: never[] }>
    >(),
  saveChat: vi.fn<(scope: AccessScope, input: unknown) => Promise<void>>(),
  startGoogleWorkspaceAuthorization:
    vi.fn<(scope: AccessScope, callbackUrl: string) => Promise<string>>(),
}));

vi.mock("@/lib/model-catalog/server", () => ({
  readModelCatalog: mocks.readModelCatalog,
}));
vi.mock("@/lib/task-history/server", () => ({
  readTaskHistoryPage: mocks.readTaskHistoryPage,
}));
vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));
vi.mock("@/lib/google-workspace/server", () => ({
  disconnectGoogleWorkspace: mocks.disconnectGoogleWorkspace,
  startGoogleWorkspaceAuthorization: mocks.startGoogleWorkspaceAuthorization,
}));
vi.mock("@/lib/manager/server/store", () => ({
  applyManagerMutation: mocks.applyManagerMutation,
}));

import { appRouter } from "./router";

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
} satisfies AccessScope;

describe("appRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the authenticated scope and cursor to task history", async () => {
    mocks.readTaskHistoryPage.mockResolvedValue({
      cursor: null,
      hasMore: false,
      runs: [],
    });

    await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .tasks.list({ cursor: "next-page" });

    expect(mocks.readTaskHistoryPage).toHaveBeenCalledWith(scope, "next-page");
  });

  it("rejects invalid chat writes before persistence", async () => {
    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .chats.save({ sessionId: "" })
    ).rejects.toThrow("Too small");
    expect(mocks.saveChat).not.toHaveBeenCalled();
  });

  it("returns a typed Google authorization redirect", async () => {
    mocks.startGoogleWorkspaceAuthorization.mockResolvedValue(
      "https://accounts.google.com/authorize"
    );

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .googleWorkspace.update("connect");

    expect(mocks.startGoogleWorkspaceAuthorization).toHaveBeenCalledWith(
      scope,
      "https://example.com/?google=connected"
    );
    expect(result).toEqual({
      redirectTo: "https://accounts.google.com/authorize",
    });
  });

  it("surfaces Google connector failures", async () => {
    mocks.disconnectGoogleWorkspace.mockRejectedValue(
      new Error("connector unavailable")
    );

    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .googleWorkspace.update("disconnect")
    ).rejects.toThrow("connector unavailable");
  });
});

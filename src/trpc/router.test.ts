import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@/lib/access-scope";
import { appRouter, routerDependencies } from "./router";

const disconnectGoogleWorkspaceMock = vi.spyOn(
  routerDependencies,
  "disconnectGoogleWorkspace"
);
const listBrowserTracesMock = vi.spyOn(routerDependencies, "listBrowserTraces");
const saveChatMock = vi.spyOn(routerDependencies, "saveChat");
const startGoogleWorkspaceAuthorizationMock = vi.spyOn(
  routerDependencies,
  "startGoogleWorkspaceAuthorization"
);

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
} satisfies AccessScope;

describe("appRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the authenticated scope and cursor to the trace history", async () => {
    listBrowserTracesMock.mockResolvedValue({
      nextCursor: null,
      traces: [],
    });

    await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .traces.list({ cursor: "next-page" });

    expect(listBrowserTracesMock).toHaveBeenCalledWith(scope, "next-page");
  });

  it("rejects invalid chat writes before persistence", async () => {
    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .chats.save({ sessionId: "" })
    ).rejects.toThrow("Too small");
    expect(saveChatMock).not.toHaveBeenCalled();
  });

  it("returns a typed Google authorization redirect", async () => {
    startGoogleWorkspaceAuthorizationMock.mockResolvedValue(
      "https://accounts.google.com/authorize"
    );

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .googleWorkspace.update("connect");

    expect(startGoogleWorkspaceAuthorizationMock).toHaveBeenCalledWith(
      scope,
      "https://example.com/?google=connected"
    );
    expect(result).toEqual({
      redirectTo: "https://accounts.google.com/authorize",
    });
  });

  it("surfaces Google connector failures", async () => {
    disconnectGoogleWorkspaceMock.mockRejectedValue(
      new Error("connector unavailable")
    );

    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .googleWorkspace.update("disconnect")
    ).rejects.toThrow("connector unavailable");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@/lib/access-scope";

const mocks = vi.hoisted(() => ({
  disconnectGoogleWorkspace: vi.fn<(scope: AccessScope) => Promise<void>>(),
  getAvailableModels: vi.fn<() => Promise<{ models: unknown[] }>>(),
  listOwnedSessionIds: vi.fn<(scope: AccessScope) => Promise<Set<string>>>(),
  listWorkflowRuns: vi.fn<
    (input: unknown) => Promise<{
      cursor: string | null;
      data: {
        attributes: Record<string, string>;
        createdAt: Date;
        runId: string;
        status: string;
        updatedAt: Date;
      }[];
      hasMore: boolean;
    }>
  >(),
  saveChat: vi.fn<(scope: AccessScope, input: unknown) => Promise<void>>(),
  startGoogleWorkspaceAuthorization: vi.fn<
    () => Promise<{
      request: string;
      url: string;
      verifier: string;
    }>
  >(),
}));

vi.mock("ai", () => ({
  gateway: { getAvailableModels: mocks.getAvailableModels },
}));
vi.mock("@workflow/world-vercel", () => ({
  createWorld: vi.fn<() => { runs: { list: typeof mocks.listWorkflowRuns } }>(
    () => ({ runs: { list: mocks.listWorkflowRuns } })
  ),
}));
vi.mock("@/db/services/sessions", () => ({
  listOwnedSessionIds: mocks.listOwnedSessionIds,
}));
vi.mock("@/db/services/chats", () => ({ saveChat: mocks.saveChat }));
vi.mock("@vercel/connect", () => ({
  revokeToken: mocks.disconnectGoogleWorkspace,
  startAuthorization: mocks.startGoogleWorkspaceAuthorization,
}));
import { appRouter } from "./router";

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
} satisfies AccessScope;

describe("appRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the authenticated scope and cursor to task history", async () => {
    mocks.listOwnedSessionIds.mockResolvedValue(new Set(["wrun_owned"]));
    mocks.listWorkflowRuns.mockResolvedValue({
      cursor: null,
      data: [
        {
          attributes: {
            "$eve.title": "Owned task",
            "$eve.type": "session",
          },
          createdAt: new Date("2026-08-25T20:00:00.000Z"),
          runId: "wrun_owned",
          status: "running",
          updatedAt: new Date("2026-08-25T20:00:08.000Z"),
        },
        {
          attributes: {
            "$eve.title": "Other task",
            "$eve.type": "session",
          },
          createdAt: new Date("2026-08-25T20:01:00.000Z"),
          runId: "wrun_other",
          status: "completed",
          updatedAt: new Date("2026-08-25T20:01:08.000Z"),
        },
      ],
      hasMore: false,
    });

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .tasks.list({ cursor: "next-page" });

    expect(mocks.listOwnedSessionIds).toHaveBeenCalledWith(scope);
    expect(mocks.listWorkflowRuns).toHaveBeenCalledWith({
      pagination: {
        cursor: "next-page",
        limit: 25,
        sortOrder: "desc",
      },
      resolveData: "none",
      workflowName: "workflow//eve//workflowEntry",
    });
    expect(result).toEqual({
      cursor: null,
      hasMore: false,
      runs: [
        {
          createdAt: "2026-08-25T20:00:00.000Z",
          prompt: "Owned task",
          sessionId: "wrun_owned",
          status: "running",
          updatedAt: "2026-08-25T20:00:08.000Z",
        },
      ],
    });
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
    mocks.startGoogleWorkspaceAuthorization.mockResolvedValue({
      request: "request",
      url: "https://accounts.google.com/authorize",
      verifier: "verifier",
    });

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .googleWorkspace.update("connect");

    expect(mocks.startGoogleWorkspaceAuthorization).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        subject: { id: scope.userId, issuer: "openinstinct", type: "user" },
      }),
      expect.objectContaining({
        callbackUrl: "https://example.com/?google=connected",
      })
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

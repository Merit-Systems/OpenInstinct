import type {
  ConnectAuthorizationOptions,
  ConnectAuthorizationResponse,
  ConnectTokenParams,
  ConnectTokenSubject,
} from "@vercel/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as BrowserTraces from "@/db/services/browser-traces";
import * as Chats from "@/db/services/chats";
import type { AccessScope } from "@/lib/access-scope";
import { squareSubject, squareTokenParams } from "@/lib/square";

interface ConnectionInstallationKey {
  readonly authorizationSubject: string;
  readonly connectorId: string;
  readonly provider: string;
}

const mocks = vi.hoisted(() => ({
  deleteRevokedConnectionInstallation:
    vi.fn<
      (scope: AccessScope, key: ConnectionInstallationKey) => Promise<boolean>
    >(),
  // SAFETY: literal starting value for a mutable per-test override; each
  // test assigns a real connector id or leaves it unset before calling.
  squareConnectorUid: undefined as string | undefined,
  revokeConnectionInstallation:
    vi.fn<
      (scope: AccessScope, key: ConnectionInstallationKey) => Promise<boolean>
    >(),
  revokeToken:
    vi.fn<
      (
        connector: string,
        params: { subject: ConnectTokenSubject; installationId?: string }
      ) => Promise<void>
    >(),
  scopeEnabled: vi.fn<() => boolean>(),
  startAuthorization:
    vi.fn<
      (
        connector: string,
        params: ConnectTokenParams,
        options?: ConnectAuthorizationOptions
      ) => Promise<ConnectAuthorizationResponse>
    >(),
}));
vi.mock("@vercel/connect", () => ({
  revokeToken: mocks.revokeToken,
  startAuthorization: mocks.startAuthorization,
}));
vi.mock("@/db/services/connection-installations", () => ({
  deleteRevokedConnectionInstallation:
    mocks.deleteRevokedConnectionInstallation,
  revokeConnectionInstallation: mocks.revokeConnectionInstallation,
}));
vi.mock(import("@/env"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get env() {
      return {
        ...actual.env,
        SQUARE_CONNECTOR_UID: mocks.squareConnectorUid,
      };
    },
    isWorkspaceScopeEnforcementEnabled: mocks.scopeEnabled,
  };
});

const { appRouter } = await import("./router");

const listBrowserTracesMock = vi.spyOn(BrowserTraces, "listBrowserTraces");
const saveChatMock = vi.spyOn(Chats, "saveChat");

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
} satisfies AccessScope;

describe("appRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.squareConnectorUid = undefined;
    mocks.scopeEnabled.mockReturnValue(false);
  });

  it("passes the authenticated scope and cursor to the trace history", async () => {
    listBrowserTracesMock.mockResolvedValue({ nextCursor: null, traces: [] });

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

  it("rejects square.update when no connector is configured", async () => {
    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .square.update("connect")
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("revokes the Square token and connection installation on disconnect", async () => {
    mocks.squareConnectorUid = "square/test-uid";
    mocks.scopeEnabled.mockReturnValue(true);
    mocks.revokeToken.mockResolvedValue(undefined);
    mocks.revokeConnectionInstallation.mockResolvedValue(true);

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .square.update("disconnect");

    expect(result).toEqual({ redirectTo: "/?square=disconnected" });
    expect(mocks.revokeToken).toHaveBeenCalledWith("square/test-uid", {
      subject: squareSubject(scope.userId),
    });
    expect(mocks.revokeConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "square" })
    );
  });

  it("resolves square.update disconnect even when connection installation revocation fails", async () => {
    mocks.squareConnectorUid = "square/test-uid";
    mocks.scopeEnabled.mockReturnValue(true);
    mocks.revokeToken.mockResolvedValue(undefined);
    mocks.revokeConnectionInstallation.mockRejectedValue(new Error("boom"));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      appRouter
        .createCaller({ origin: "https://example.com", scope })
        .square.update("disconnect")
    ).resolves.toEqual({ redirectTo: "/?square=disconnected" });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("clears the revoked installation before starting authorization on connect", async () => {
    mocks.squareConnectorUid = "square/test-uid";
    mocks.scopeEnabled.mockReturnValue(true);
    mocks.deleteRevokedConnectionInstallation.mockResolvedValue(true);
    mocks.startAuthorization.mockResolvedValue({
      request: "request-token",
      url: "https://connect.example.com/authorize",
      verifier: "verifier-token",
    });

    const result = await appRouter
      .createCaller({ origin: "https://example.com", scope })
      .square.update("connect");

    expect(result).toEqual({
      redirectTo: "https://connect.example.com/authorize",
    });
    expect(mocks.deleteRevokedConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "square" })
    );
    const call = mocks.startAuthorization.mock.calls.at(0);
    if (!call) throw new Error("startAuthorization was not called");
    const [connectorId, tokenParams, options] = call;
    expect(connectorId).toBe("square/test-uid");
    expect(tokenParams).toEqual(squareTokenParams(scope.userId));
    expect(options?.callbackUrl ?? "").toMatch(/\/\?square=connected$/);
    const deleteOrder =
      mocks.deleteRevokedConnectionInstallation.mock.invocationCallOrder[0];
    const startOrder = mocks.startAuthorization.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(startOrder ?? Number.POSITIVE_INFINITY);
  });
});

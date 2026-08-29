import type * as EnvModule from "@/lib/env";
import type * as VercelConnect from "@vercel/connect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteRevokedConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  findConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  getTokenResponse: vi.fn<() => Promise<unknown>>(),
  recordConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  revokeConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
}));

vi.mock("@vercel/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof VercelConnect>()),
  getTokenResponse: mocks.getTokenResponse,
  revokeToken: vi.fn<() => Promise<void>>(),
  startAuthorization: vi
    .fn<() => Promise<{ url: string }>>()
    .mockResolvedValue({ url: "https://connect.test" }),
}));
vi.mock("@/db/services/connection-installations", () => ({
  deleteRevokedConnectionInstallation:
    mocks.deleteRevokedConnectionInstallation,
  findConnectionInstallation: mocks.findConnectionInstallation,
  recordConnectionInstallation: mocks.recordConnectionInstallation,
  revokeConnectionInstallation: mocks.revokeConnectionInstallation,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));

const {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceConnection,
  startGoogleWorkspaceAuthorization,
} = await import("@/lib/google-workspace/server");
const scope = { userId: "better-auth:alice", workspaceId: "workspace:alice" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeEnforcementEnabled.mockReturnValue(true);
  mocks.getTokenResponse.mockResolvedValue({
    claims: { email: "alice@example.test" },
  });
  mocks.recordConnectionInstallation.mockResolvedValue({ status: "active" });
  mocks.deleteRevokedConnectionInstallation.mockResolvedValue(false);
});

describe("Google Workspace connection installations", () => {
  it("denies a revoked installation before requesting a token", async () => {
    mocks.findConnectionInstallation.mockResolvedValue({ status: "revoked" });

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toEqual({
      accountLabel: null,
      state: "disconnected",
    });
    expect(mocks.getTokenResponse).not.toHaveBeenCalled();
  });

  it("allows a missing record to bootstrap after a successful token lookup", async () => {
    mocks.findConnectionInstallation.mockResolvedValue(undefined);

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });
    expect(mocks.recordConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );
  });

  it("does not query installation records while enforcement is off", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(false);

    await getGoogleWorkspaceConnection(scope);

    expect(mocks.findConnectionInstallation).not.toHaveBeenCalled();
    expect(mocks.recordConnectionInstallation).not.toHaveBeenCalled();
  });

  it("clears a revoked installation when the user starts reconnecting", async () => {
    await startGoogleWorkspaceAuthorization(scope, "https://app.test/");

    expect(mocks.deleteRevokedConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );
  });

  it("supports the connect-disconnect-reconnect lifecycle", async () => {
    mocks.findConnectionInstallation
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });
    await disconnectGoogleWorkspace(scope);
    await startGoogleWorkspaceAuthorization(scope, "https://app.test/");
    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });

    expect(mocks.revokeConnectionInstallation).toHaveBeenCalledOnce();
    expect(mocks.deleteRevokedConnectionInstallation).toHaveBeenCalledOnce();
    expect(mocks.recordConnectionInstallation).toHaveBeenCalledTimes(2);
  });

  it("keeps a healthy connection usable when installation storage fails", async () => {
    mocks.findConnectionInstallation.mockRejectedValue(new Error("database"));
    mocks.recordConnectionInstallation.mockRejectedValue(new Error("database"));

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });
  });

  it("records disconnect revocation only while enforcement is on", async () => {
    await disconnectGoogleWorkspace(scope);
    expect(mocks.revokeConnectionInstallation).toHaveBeenCalledExactlyOnceWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );

    mocks.scopeEnforcementEnabled.mockReturnValue(false);
    await disconnectGoogleWorkspace(scope);
  });

  it("does not fail a disconnect after Connect has revoked the token", async () => {
    mocks.revokeConnectionInstallation.mockRejectedValue(new Error("database"));

    await expect(disconnectGoogleWorkspace(scope)).resolves.toBeUndefined();
  });
});

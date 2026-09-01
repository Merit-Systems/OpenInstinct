import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceConnection,
  googleWorkspaceInstallationDependencies,
  googleWorkspaceServerDependencies,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";

const deleteRevokedConnectionInstallation =
  vi.fn<
    typeof googleWorkspaceInstallationDependencies.deleteRevokedConnectionInstallation
  >();
const findConnectionInstallation =
  vi.fn<
    typeof googleWorkspaceInstallationDependencies.findConnectionInstallation
  >();
const getTokenResponse =
  vi.fn<typeof googleWorkspaceServerDependencies.getTokenResponse>();
const recordConnectionInstallation =
  vi.fn<
    typeof googleWorkspaceInstallationDependencies.recordConnectionInstallation
  >();
const revokeConnectionInstallation =
  vi.fn<
    typeof googleWorkspaceInstallationDependencies.revokeConnectionInstallation
  >();
const revokeToken =
  vi.fn<typeof googleWorkspaceServerDependencies.revokeToken>();
const startAuthorization =
  vi.fn<typeof googleWorkspaceServerDependencies.startAuthorization>();
const isWorkspaceScopeEnforcementEnabled =
  vi.fn<
    typeof googleWorkspaceInstallationDependencies.isWorkspaceScopeEnforcementEnabled
  >();
const originalInstallationDependencies = {
  ...googleWorkspaceInstallationDependencies,
};
const originalServerDependencies = { ...googleWorkspaceServerDependencies };
const scope = { userId: "better-auth:alice", workspaceId: "workspace:alice" };

beforeEach(() => {
  vi.clearAllMocks();
  isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
  getTokenResponse.mockResolvedValue({
    claims: { email: "alice@example.test" },
    connector: { id: "connector-id", type: "oauth", uid: "google/test" },
    expiresAt: 1_800_000_000_000,
    token: "google-token",
  });
  recordConnectionInstallation.mockResolvedValue(connectionInstallation());
  deleteRevokedConnectionInstallation.mockResolvedValue(false);
  revokeToken.mockResolvedValue(undefined);
  startAuthorization.mockResolvedValue({
    request: "request",
    url: "https://connect.test",
    verifier: "verifier",
  });
  Object.assign(googleWorkspaceInstallationDependencies, {
    deleteRevokedConnectionInstallation,
    findConnectionInstallation,
    isWorkspaceScopeEnforcementEnabled,
    recordConnectionInstallation,
    revokeConnectionInstallation,
  });
  Object.assign(googleWorkspaceServerDependencies, {
    getTokenResponse,
    revokeToken,
    startAuthorization,
  });
});

afterEach(() => {
  Object.assign(
    googleWorkspaceInstallationDependencies,
    originalInstallationDependencies
  );
  Object.assign(googleWorkspaceServerDependencies, originalServerDependencies);
});

describe("Google Workspace connection installations", () => {
  it("denies a revoked installation before requesting a token", async () => {
    findConnectionInstallation.mockResolvedValue(
      connectionInstallation({ status: "revoked" })
    );

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toEqual({
      accountLabel: null,
      state: "disconnected",
    });
    expect(getTokenResponse).not.toHaveBeenCalled();
  });

  it("allows a missing record to bootstrap after a successful token lookup", async () => {
    findConnectionInstallation.mockResolvedValue(undefined);

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });
    expect(recordConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );
  });

  it("does not query installation records while enforcement is off", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);

    await getGoogleWorkspaceConnection(scope);

    expect(findConnectionInstallation).not.toHaveBeenCalled();
    expect(recordConnectionInstallation).not.toHaveBeenCalled();
  });

  it("clears a revoked installation when the user starts reconnecting", async () => {
    await startGoogleWorkspaceAuthorization(scope, "https://app.test/");

    expect(deleteRevokedConnectionInstallation).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );
  });

  it("supports the connect-disconnect-reconnect lifecycle", async () => {
    findConnectionInstallation
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

    expect(revokeConnectionInstallation).toHaveBeenCalledOnce();
    expect(deleteRevokedConnectionInstallation).toHaveBeenCalledOnce();
    expect(recordConnectionInstallation).toHaveBeenCalledTimes(2);
  });

  it("keeps a healthy connection usable when installation storage fails", async () => {
    findConnectionInstallation.mockRejectedValue(new Error("database"));
    recordConnectionInstallation.mockRejectedValue(new Error("database"));

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toMatchObject({
      state: "connected",
    });
  });

  it("records disconnect revocation only while enforcement is on", async () => {
    await disconnectGoogleWorkspace(scope);
    expect(revokeConnectionInstallation).toHaveBeenCalledExactlyOnceWith(
      scope,
      expect.objectContaining({ provider: "google" })
    );

    isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);
    await disconnectGoogleWorkspace(scope);
  });

  it("does not fail a disconnect after Connect has revoked the token", async () => {
    revokeConnectionInstallation.mockRejectedValue(new Error("database"));

    await expect(disconnectGoogleWorkspace(scope)).resolves.toBeUndefined();
  });
});

function connectionInstallation({ status = "active" } = {}) {
  return {
    authorizationSubject: "google:alice",
    connectorId: "google/test",
    createdAt: "2026-09-01T00:00:00.000Z",
    id: "installation-1",
    provider: "google",
    revokedAt: null,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    status,
    updatedAt: "2026-09-01T00:00:00.000Z",
    workspaceId: "workspace:alice",
  };
}

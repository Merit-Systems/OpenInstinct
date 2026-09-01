import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWithGoogleAuth,
  googleWorkspaceClientDependencies,
  type GoogleAuthContext,
  type GoogleOAuthClient,
  type GoogleWorkspaceClientDependencies,
} from "@/agent/lib/google-workspace/client";

const createOAuthClient = vi.fn<() => GoogleOAuthClient>();
const findConnectionInstallation =
  vi.fn<typeof googleWorkspaceClientDependencies.findConnectionInstallation>();
const isWorkspaceScopeEnforcementEnabled =
  vi.fn<
    typeof googleWorkspaceClientDependencies.isWorkspaceScopeEnforcementEnabled
  >();
const recordConnectionInstallation =
  vi.fn<
    typeof googleWorkspaceClientDependencies.recordConnectionInstallation
  >();
const verifyScopeAccess =
  vi.fn<typeof googleWorkspaceClientDependencies.verifyScopeAccess>();
const setCredentials =
  vi.fn<(credentials: { readonly access_token: string }) => void>();
const dependencies: GoogleWorkspaceClientDependencies<GoogleOAuthClient> = {
  ...googleWorkspaceClientDependencies,
  connectorId: "google/test",
  createOAuthClient,
  findConnectionInstallation,
  isWorkspaceScopeEnforcementEnabled,
  recordConnectionInstallation,
  verifyScopeAccess,
};
const withGoogleAuth = createWithGoogleAuth(dependencies);

beforeEach(() => {
  vi.clearAllMocks();
  isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
  verifyScopeAccess.mockResolvedValue(verifiedScope());
  findConnectionInstallation.mockResolvedValue(undefined);
  recordConnectionInstallation.mockResolvedValue(connectionInstallation());
  createOAuthClient.mockReturnValue({ setCredentials });
});

describe("agent Google Workspace installation authorization", () => {
  it("denies a revoked installation before requesting a token", async () => {
    const ctx = toolContext();
    findConnectionInstallation.mockResolvedValue(
      connectionInstallation({ status: "revoked" })
    );

    await expect(withGoogleAuth(ctx, async () => "unused")).rejects.toThrow(
      "revoked"
    );
    expect(ctx.getAccessToken).not.toHaveBeenCalled();
  });

  it("bootstraps an absent installation after obtaining a token", async () => {
    const ctx = toolContext();

    await expect(withGoogleAuth(ctx, async () => "ok")).resolves.toBe("ok");

    expect(recordConnectionInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "google" })
    );
  });

  it("does not query installation state while enforcement is off", async () => {
    const ctx = toolContext();
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);

    await withGoogleAuth(ctx, async () => "ok");

    expect(verifyScopeAccess).not.toHaveBeenCalled();
    expect(findConnectionInstallation).not.toHaveBeenCalled();
    expect(recordConnectionInstallation).not.toHaveBeenCalled();
  });
});

function toolContext(): GoogleAuthContext & {
  readonly getAccessToken: ReturnType<
    typeof vi.fn<GoogleAuthContext["getAccessToken"]>
  >;
} {
  const getAccessToken = vi
    .fn<GoogleAuthContext["getAccessToken"]>()
    .mockResolvedValue("google-access-token");
  return {
    caller: {
      attributes: { workspaceId: "workspace:alice" },
      id: "better-auth:alice",
      type: "user",
    },
    getAccessToken,
    requireGoogleAuthorization:
      vi.fn<GoogleAuthContext["requireGoogleAuthorization"]>(),
  };
}

function verifiedScope() {
  return {
    membershipStatus: "active" as const,
    role: "owner" as const,
    userId: "alice",
    workspaceId: "workspace:alice",
  };
}

function connectionInstallation({ status = "active" } = {}) {
  return {
    authorizationSubject: "google:alice",
    connectorId: "google/test",
    createdAt: "2026-08-31T00:00:00.000Z",
    id: "installation-1",
    provider: "google",
    revokedAt: null,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    status,
    updatedAt: "2026-08-31T00:00:00.000Z",
    workspaceId: "workspace:alice",
  };
}

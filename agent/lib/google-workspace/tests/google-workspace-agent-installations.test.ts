import type { ToolContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstallation:
    vi.fn<() => Promise<{ readonly status: string } | undefined>>(),
  recordInstallation: vi.fn<() => Promise<void>>(),
  setCredentials:
    vi.fn<(credentials: { readonly access_token: string }) => void>(),
  scopeEnabled: vi.fn<() => boolean>(),
  verifyScope: vi.fn<
    () => Promise<
      | {
          readonly membershipStatus: string;
          readonly role: string;
          readonly userId: string;
          readonly workspaceId: string;
        }
      | undefined
    >
  >(),
}));
vi.mock("@googleapis/gmail", () => ({
  auth: {
    OAuth2: class {
      setCredentials = mocks.setCredentials;
    },
  },
}));
vi.mock("@vercel/connect/eve", () => ({
  connect: vi.fn<() => { readonly connector: string }>(() => ({
    connector: "google/test",
  })),
}));
vi.mock("@/env", () => ({
  env: { GOOGLE_CONNECTOR_UID: "google/test" },
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnabled,
}));
vi.mock("@/db/services/connection-installations", () => ({
  findConnectionInstallation: mocks.findInstallation,
  recordConnectionInstallation: mocks.recordInstallation,
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScope,
}));

const { withGoogleAuth } = await import("@/agent/lib/google-workspace/client");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeEnabled.mockReturnValue(true);
  mocks.verifyScope.mockResolvedValue({
    membershipStatus: "active",
    role: "owner",
    userId: "better-auth:alice",
    workspaceId: "workspace:alice",
  });
  mocks.findInstallation.mockResolvedValue(undefined);
  mocks.recordInstallation.mockResolvedValue(undefined);
});

describe("agent Google Workspace installation authorization", () => {
  it("denies a revoked installation before requesting a token", async () => {
    const ctx = toolContext();
    mocks.findInstallation.mockResolvedValue(installation("revoked"));
    await expect(withGoogleAuth(ctx, async () => "unused")).rejects.toThrow(
      "revoked"
    );
    expect(ctx.getToken).not.toHaveBeenCalled();
  });
  it("bootstraps an absent installation after obtaining a token", async () => {
    const ctx = toolContext();
    await expect(withGoogleAuth(ctx, async () => "ok")).resolves.toBe("ok");
    expect(mocks.recordInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "google" })
    );
    expect(mocks.setCredentials).toHaveBeenCalledWith({
      access_token: "google-access-token",
    });
  });
  it("does not query installation state while enforcement is off", async () => {
    const ctx = toolContext();
    mocks.scopeEnabled.mockReturnValue(false);
    await withGoogleAuth(ctx, async () => "ok");
    expect(mocks.verifyScope).not.toHaveBeenCalled();
    expect(mocks.findInstallation).not.toHaveBeenCalled();
    expect(mocks.recordInstallation).not.toHaveBeenCalled();
  });
});
function toolContext() {
  const getToken = vi
    .fn<ToolContext["getToken"]>()
    .mockResolvedValue({ token: "google-access-token" });
  const requireAuth = vi.fn<ToolContext["requireAuth"]>();
  return {
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    getToken,
    requireAuth,
    session: {
      auth: {
        current: {
          attributes: { workspaceId: "workspace:alice" },
          authenticator: "test",
          principalId: "better-auth:alice",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "google-workspace-test",
  } satisfies ToolContext;
}
function installation(status = "active") {
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

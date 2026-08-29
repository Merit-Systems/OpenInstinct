import type * as EnvModule from "@/lib/env";
import type { ToolContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  recordConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
  setCredentials: vi.fn<(credentials: { access_token: string }) => void>(),
  verifyScopeAccess: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@googleapis/gmail", () => ({
  auth: {
    OAuth2: class {
      setCredentials = mocks.setCredentials;
    },
  },
}));
vi.mock("@vercel/connect/eve", () => ({
  connect: vi.fn<() => object>(() => ({})),
}));
vi.mock("@/db/services/connection-installations", () => ({
  findConnectionInstallation: mocks.findConnectionInstallation,
  recordConnectionInstallation: mocks.recordConnectionInstallation,
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScopeAccess,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));

const { withGoogleAuth } = await import("@/agent/lib/google-workspace/client");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeEnforcementEnabled.mockReturnValue(true);
  mocks.verifyScopeAccess.mockResolvedValue({});
  mocks.findConnectionInstallation.mockResolvedValue(undefined);
  mocks.recordConnectionInstallation.mockResolvedValue({ status: "active" });
});

describe("agent Google Workspace installation authorization", () => {
  it("denies a revoked installation before requesting a token", async () => {
    const ctx = toolContext();
    mocks.findConnectionInstallation.mockResolvedValue({ status: "revoked" });

    await expect(withGoogleAuth(ctx, async () => "unused")).rejects.toThrow(
      "revoked"
    );
    expect(ctx.getToken).not.toHaveBeenCalled();
  });

  it("bootstraps an absent installation after obtaining a token", async () => {
    const ctx = toolContext();

    await expect(withGoogleAuth(ctx, async () => "ok")).resolves.toBe("ok");

    expect(mocks.recordConnectionInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "google" })
    );
  });

  it("does not query installation state while enforcement is off", async () => {
    const ctx = toolContext();
    mocks.scopeEnforcementEnabled.mockReturnValue(false);

    await withGoogleAuth(ctx, async () => "ok");

    expect(mocks.verifyScopeAccess).not.toHaveBeenCalled();
    expect(mocks.findConnectionInstallation).not.toHaveBeenCalled();
    expect(mocks.recordConnectionInstallation).not.toHaveBeenCalled();
  });
});

function toolContext() {
  const getToken = vi
    .fn<ToolContext["getToken"]>()
    .mockResolvedValue({ token: "google-access-token" });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture supplies exactly the ToolContext fields exercised by this helper.
  return {
    getToken,
    session: {
      auth: {
        current: {
          attributes: { workspaceId: "workspace:alice" },
          id: "better-auth:alice",
        },
      },
    },
  } as unknown as ToolContext & { getToken: typeof getToken };
}

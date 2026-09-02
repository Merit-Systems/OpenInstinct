import type { ConnectTokenSubject } from "@vercel/connect";
import type { ConnectionPrincipal } from "eve/connections";
import type { SessionContext } from "eve/context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "@/lib/access-scope";
import { squareScopes } from "@/lib/square";

interface RecordedInstallation {
  readonly authorizationSubject: string;
  readonly connectorId: string;
  readonly provider: string;
  readonly scopes: readonly string[];
}

interface SquareConnectOptions {
  readonly connector: string;
  readonly createSubject: (
    principal: ConnectionPrincipal
  ) => ConnectTokenSubject;
  readonly tokenParams?: { readonly scopes: readonly string[] };
  readonly validate?: boolean;
}

const mocks = vi.hoisted(() => ({
  findInstallation:
    vi.fn<() => Promise<{ readonly status: string } | undefined>>(),
  recordInstallation:
    vi.fn<
      (scope: AccessScope, installation: RecordedInstallation) => Promise<void>
    >(),
  connect: vi.fn<
    (options: SquareConnectOptions) => { readonly connector: string }
  >((options) => ({ connector: options.connector })),
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
vi.mock("@vercel/connect/eve", () => ({
  connect: mocks.connect,
}));
vi.mock("@/env", () => ({
  env: { SQUARE_CONNECTOR_UID: "square/test" },
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnabled,
}));
vi.mock("@/db/services/connection-installations", () => ({
  findConnectionInstallation: mocks.findInstallation,
  recordConnectionInstallation: mocks.recordInstallation,
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScope,
}));

const { squareAuth } = await import("@/agent/lib/square/auth");

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

describe("square connection auth resolver", () => {
  it("denies a revoked installation before calling connect()", async () => {
    mocks.findInstallation.mockResolvedValue(installation("revoked"));

    await expect(squareAuth(sessionContext())).rejects.toThrow("revoked");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("records an absent installation with the square provider and scopes", async () => {
    await squareAuth(sessionContext());

    expect(mocks.recordInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ provider: "square" })
    );
    const [, recorded] = mocks.recordInstallation.mock.calls.at(0) ?? [];
    expect(recorded).toMatchObject({
      scopes: [...squareScopes],
    });
    expect(mocks.connect).toHaveBeenCalled();
  });

  it("does not query installation state while enforcement is off", async () => {
    mocks.scopeEnabled.mockReturnValue(false);

    await squareAuth(sessionContext());

    expect(mocks.verifyScope).not.toHaveBeenCalled();
    expect(mocks.findInstallation).not.toHaveBeenCalled();
    expect(mocks.recordInstallation).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalled();
  });

  it("throws an error naming SQUARE_CONNECTOR_UID when the connector is unset", async () => {
    vi.doMock("@/env", () => ({
      env: { SQUARE_CONNECTOR_UID: undefined },
      isWorkspaceScopeEnforcementEnabled: mocks.scopeEnabled,
    }));
    vi.resetModules();
    const { squareAuth: unsetSquareAuth } =
      await import("@/agent/lib/square/auth");

    await expect(unsetSquareAuth(sessionContext())).rejects.toThrow(
      "SQUARE_CONNECTOR_UID"
    );
  });

  it("rejects a non-user principal in createSubject", async () => {
    await squareAuth(sessionContext());
    const call = mocks.connect.mock.calls.at(0);
    if (!call) throw new Error("connect() was not called");
    const [options] = call;

    expect(() => options.createSubject({ type: "app" })).toThrow(
      "authenticated OpenInstinct user"
    );
  });
});

function sessionContext(): SessionContext {
  return {
    getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
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
  } satisfies SessionContext;
}
function installation(status = "active") {
  return {
    authorizationSubject: "square:alice",
    connectorId: "square/test",
    createdAt: "2026-08-31T00:00:00.000Z",
    id: "installation-1",
    provider: "square",
    revokedAt: null,
    scopes: ["MERCHANT_PROFILE_READ"],
    status,
    updatedAt: "2026-08-31T00:00:00.000Z",
    workspaceId: "workspace:alice",
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@/lib/access-scope";

const mocks = vi.hoisted(() => ({
  createBinding:
    vi.fn<() => Promise<{ readonly workspaceId: string } | undefined>>(),
  findOne:
    vi.fn<
      () => Promise<
        { readonly id: string; readonly phoneNumberVerified: true } | undefined
      >
    >(),
  findIdentity:
    vi.fn<
      () => Promise<
        | { readonly phoneIdentityId: string; readonly userId: string }
        | undefined
      >
    >(),
  enabled: vi.fn<() => boolean>(),
  recordInstallation: vi.fn<() => Promise<void>>(),
  resolveBinding:
    vi.fn<() => Promise<{ readonly workspaceId: string } | undefined>>(),
  verifyScope:
    vi.fn<() => Promise<{ readonly workspaceId: string } | undefined>>(),
}));
vi.mock("@/auth", () => ({
  getAuth: vi.fn<
    () => Promise<{
      readonly $context: Promise<{
        readonly adapter: { readonly findOne: typeof mocks.findOne };
      }>;
    }>
  >(async () => ({
    $context: Promise.resolve({ adapter: { findOne: mocks.findOne } }),
  })),
}));
vi.mock("@/env", () => ({
  env: { LINQ_CONNECTOR: "linq/test", LINQ_PHONE_NUMBER: "+12025550999" },
  isWorkspaceScopeEnforcementEnabled: mocks.enabled,
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScope,
}));
vi.mock("@/db/services/channel-conversations", () => ({
  createConversationBinding: mocks.createBinding,
  resolveConversationBinding: mocks.resolveBinding,
}));
vi.mock("@/db/services/connection-installations", () => ({
  recordConnectionInstallation: mocks.recordInstallation,
}));
vi.mock("@/db/services/phone-identities", () => ({
  findVerifiedUserByPhoneNumber: mocks.findIdentity,
}));

const { linqChannelConfig } = await import("../../agent/channels/linq");
type OnMessage = typeof linqChannelConfig.onMessage;
type Context = Parameters<OnMessage>[0];
type Message = Parameters<OnMessage>[1];
const workspaceId = accessScopeForUser("better-auth:alice").workspaceId;
const message = (): Message => ({
  author: { isBot: false, userId: "linq-user", userName: "+12025550123" },
});
const context = (threadId?: string): Context => ({
  thread: { id: threadId ?? "" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(false);
  mocks.findOne.mockResolvedValue(undefined);
  mocks.findIdentity.mockResolvedValue(undefined);
  mocks.resolveBinding.mockResolvedValue(undefined);
  mocks.createBinding.mockResolvedValue(undefined);
  mocks.recordInstallation.mockResolvedValue(undefined);
});

describe("Linq channel scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    expect(
      await linqChannelConfig.onMessage(context(), message())
    ).not.toBeNull();
    expect(mocks.verifyScope).not.toHaveBeenCalled();
  });
  it("drops a denied scope while enforcement is on", async () => {
    mocks.enabled.mockReturnValue(true);
    mocks.verifyScope.mockResolvedValue(undefined);
    await expect(
      linqChannelConfig.onMessage(context(), message())
    ).resolves.toBeNull();
  });
  it("does not resolve conversation bindings while enforcement is off", async () => {
    await linqChannelConfig.onMessage(context(), message());
    expect(mocks.resolveBinding).not.toHaveBeenCalled();
    expect(mocks.createBinding).not.toHaveBeenCalled();
  });
  it("drops an existing binding owned by another workspace", async () => {
    allowAlice();
    mocks.resolveBinding.mockResolvedValue(binding("workspace:other"));
    await expect(
      linqChannelConfig.onMessage(context("linq:chat-1:dm"), message())
    ).resolves.toBeNull();
  });
  it("preserves behavior when no active agent can create a binding", async () => {
    allowAlice();
    expect(
      await linqChannelConfig.onMessage(context("linq:chat-1:dm"), message())
    ).not.toBeNull();
    expect(mocks.createBinding).toHaveBeenCalledOnce();
  });
  it("records the Linq installation for a newly bound workspace", async () => {
    allowAlice();
    mocks.createBinding.mockResolvedValue(binding(workspaceId));
    await linqChannelConfig.onMessage(context("linq:chat-1:dm"), message());
    expect(mocks.recordInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        authorizationSubject: "+12025550999",
        connectorId: "linq/test",
        provider: "linq",
      })
    );
  });
  it("keeps the message when installation recording fails", async () => {
    allowAlice();
    mocks.createBinding.mockResolvedValue(binding(workspaceId));
    mocks.recordInstallation.mockRejectedValue(
      new Error("database unavailable")
    );
    expect(
      await linqChannelConfig.onMessage(context("linq:chat-1:dm"), message())
    ).not.toBeNull();
  });
  it("does not re-record an installation for an existing binding", async () => {
    allowAlice();
    mocks.resolveBinding.mockResolvedValue(binding(workspaceId));
    await linqChannelConfig.onMessage(context("linq:chat-1:dm"), message());
    expect(mocks.recordInstallation).not.toHaveBeenCalled();
  });
  it("does not attempt a binding when the phone identity belongs to another user", async () => {
    mocks.enabled.mockReturnValue(true);
    mocks.verifyScope.mockResolvedValue(scope());
    mocks.findOne.mockResolvedValue({ id: "alice", phoneNumberVerified: true });
    mocks.findIdentity.mockResolvedValue({
      phoneIdentityId: "identity-bob",
      userId: "bob",
    });
    await linqChannelConfig.onMessage(context("linq:chat-1:dm"), message());
    expect(mocks.resolveBinding).not.toHaveBeenCalled();
    expect(mocks.createBinding).not.toHaveBeenCalled();
  });
});
function allowAlice() {
  mocks.enabled.mockReturnValue(true);
  mocks.verifyScope.mockResolvedValue(scope());
  mocks.findOne.mockResolvedValue({ id: "alice", phoneNumberVerified: true });
  mocks.findIdentity.mockResolvedValue({
    phoneIdentityId: "identity-alice",
    userId: "alice",
  });
}
function scope() {
  return {
    membershipStatus: "active",
    role: "owner",
    userId: "alice",
    workspaceId,
  };
}
function binding(bindingWorkspaceId: string) {
  return {
    agentId: "agent-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    id: "binding-1",
    pinnedRevisionId: "revision-1",
    platformLine: {
      connectorId: "linq/test",
      createdAt: "2026-09-01T00:00:00.000Z",
      environment: null,
      id: "line-1",
      provider: "linq",
      providerLineId: "+12025550999",
      status: "active",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    platformLineId: "line-1",
    provider: "linq",
    providerAccountId: "linq",
    providerConversationId: "chat-1",
    status: "active",
    updatedAt: "2026-09-01T00:00:00.000Z",
    workspaceId: bindingWorkspaceId,
  };
}

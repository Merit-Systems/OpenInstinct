import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@/lib/access-scope";
import type { VerifiedAccessScope } from "@/db/services/scope";
import {
  createLinqOnMessage,
  linqChannelDependencies,
  type LinqInboundContext,
  type LinqInboundMessage,
} from "../../agent/channels/linq";

const createConversationBinding =
  vi.fn<typeof linqChannelDependencies.createConversationBinding>();
const findVerifiedAuthUserIdByPhoneNumber =
  vi.fn<typeof linqChannelDependencies.findVerifiedAuthUserIdByPhoneNumber>();
const findVerifiedUserByPhoneNumber =
  vi.fn<typeof linqChannelDependencies.findVerifiedUserByPhoneNumber>();
const recordConnectionInstallation =
  vi.fn<typeof linqChannelDependencies.recordConnectionInstallation>();
const resolveConversationBinding =
  vi.fn<typeof linqChannelDependencies.resolveConversationBinding>();
const isWorkspaceScopeEnforcementEnabled =
  vi.fn<typeof linqChannelDependencies.isWorkspaceScopeEnforcementEnabled>();
const verifyScopeAccess =
  vi.fn<typeof linqChannelDependencies.verifyScopeAccess>();
const originalDependencies = { ...linqChannelDependencies };
const onMessage = createLinqOnMessage();
const aliceWorkspaceId = accessScopeForUser("better-auth:alice").workspaceId;
const message = (): LinqInboundMessage => ({
  author: { isBot: false, userId: "linq-user", userName: "+12025550123" },
});
const context = (threadId?: string): LinqInboundContext =>
  threadId ? { thread: { id: threadId } } : {};

beforeEach(() => {
  vi.clearAllMocks();
  isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);
  findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue(undefined);
  findVerifiedUserByPhoneNumber.mockResolvedValue(undefined);
  resolveConversationBinding.mockResolvedValue(undefined);
  createConversationBinding.mockResolvedValue(undefined);
  recordConnectionInstallation.mockResolvedValue(connectionInstallation());
  Object.assign(linqChannelDependencies, {
    createConversationBinding,
    findVerifiedAuthUserIdByPhoneNumber,
    findVerifiedUserByPhoneNumber,
    isWorkspaceScopeEnforcementEnabled,
    recordConnectionInstallation,
    resolveConversationBinding,
    verifyScopeAccess,
    linqConfiguration: () => ({
      connector: "linq/test",
      phoneNumber: "+12025550999",
    }),
  });
});

afterEach(() => {
  Object.assign(linqChannelDependencies, originalDependencies);
});

describe("Linq channel scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    const result = await onMessage(context(), message());

    expect(result).not.toBeNull();
    expect(verifyScopeAccess).not.toHaveBeenCalled();
  });

  it("drops a denied scope while enforcement is on", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(undefined);

    await expect(onMessage(context(), message())).resolves.toBeNull();
  });

  it("does not resolve conversation bindings while enforcement is off", async () => {
    await onMessage(context(), message());

    expect(resolveConversationBinding).not.toHaveBeenCalled();
    expect(createConversationBinding).not.toHaveBeenCalled();
  });

  it("drops an existing binding owned by another workspace", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    resolveConversationBinding.mockResolvedValue(
      conversationBinding({ workspaceId: "workspace:other" })
    );

    await expect(
      onMessage(context("linq:chat-1:dm"), message())
    ).resolves.toBeNull();
  });

  it("preserves the current behavior when no active agent can create a binding", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });

    expect(
      await onMessage(context("linq:chat-1:dm"), message())
    ).not.toBeNull();
    expect(createConversationBinding).toHaveBeenCalledOnce();
  });

  it("records the Linq installation for a newly bound workspace", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    createConversationBinding.mockResolvedValue(
      conversationBinding({ workspaceId: aliceWorkspaceId })
    );

    await onMessage(context("linq:chat-1:dm"), message());

    expect(recordConnectionInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        authorizationSubject: "+12025550999",
        connectorId: "linq/test",
        provider: "linq",
      })
    );
  });

  it("keeps the message when installation recording fails", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    createConversationBinding.mockResolvedValue(
      conversationBinding({ workspaceId: aliceWorkspaceId })
    );
    recordConnectionInstallation.mockRejectedValue(
      new Error("database unavailable")
    );

    expect(
      await onMessage(context("linq:chat-1:dm"), message())
    ).not.toBeNull();
  });

  it("does not re-record an installation for an existing binding", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    resolveConversationBinding.mockResolvedValue(
      conversationBinding({ workspaceId: aliceWorkspaceId })
    );

    await onMessage(context("linq:chat-1:dm"), message());

    expect(recordConnectionInstallation).not.toHaveBeenCalled();
  });

  it("does not attempt a binding when the phone identity belongs to another user", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(verifiedScope());
    findVerifiedAuthUserIdByPhoneNumber.mockResolvedValue("alice");
    findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-bob",
      userId: "bob",
    });

    await onMessage(context("linq:chat-1:dm"), message());

    expect(resolveConversationBinding).not.toHaveBeenCalled();
    expect(createConversationBinding).not.toHaveBeenCalled();
  });
});

function verifiedScope(): VerifiedAccessScope {
  return {
    membershipStatus: "active",
    role: "owner",
    userId: "alice",
    workspaceId: aliceWorkspaceId,
  };
}

function connectionInstallation() {
  return {
    authorizationSubject: "+12025550999",
    connectorId: "linq/test",
    createdAt: "2026-09-01T00:00:00.000Z",
    id: "installation-1",
    provider: "linq",
    revokedAt: null,
    scopes: null,
    status: "active",
    updatedAt: "2026-09-01T00:00:00.000Z",
    workspaceId: aliceWorkspaceId,
  };
}

function conversationBinding({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
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
    workspaceId,
  };
}

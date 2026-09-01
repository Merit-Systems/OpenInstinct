/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- Eve's Linq adapter exposes the inbound handler through transitive any types; this fixture supplies only the fields it exercises. */
import type * as EnvModule from "@/lib/env";
import type * as LinqModule from "eve/channels/linq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser } from "@/lib/access-scope";

const mocks = vi.hoisted(() => ({
  createConversationBinding: vi.fn<() => Promise<unknown>>(),
  config: undefined as unknown,
  findVerifiedUserByPhoneNumber: vi.fn<() => Promise<unknown>>(),
  findOne: vi.fn<() => Promise<unknown>>(),
  resolveConversationBinding: vi.fn<() => Promise<unknown>>(),
  recordConnectionInstallation: vi.fn<() => Promise<unknown>>(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
  verifyScopeAccess: vi.fn<(_scope: unknown) => Promise<unknown>>(),
}));

vi.mock("@/auth", () => ({
  getAuth: () =>
    Promise.resolve({
      $context: Promise.resolve({ adapter: { findOne: mocks.findOne } }),
    }),
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScopeAccess,
}));
vi.mock("@/db/services/channel-conversations", () => ({
  createConversationBinding: mocks.createConversationBinding,
  resolveConversationBinding: mocks.resolveConversationBinding,
}));
vi.mock("@/db/services/connection-installations", () => ({
  recordConnectionInstallation: mocks.recordConnectionInstallation,
}));
vi.mock("@/db/services/phone-identities", () => ({
  findVerifiedUserByPhoneNumber: mocks.findVerifiedUserByPhoneNumber,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  env: {
    ...(await importOriginal<typeof EnvModule>()).env,
    LINQ_CONNECTOR: "linq/test",
    LINQ_PHONE_NUMBER: "+12025550999",
  },
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));
vi.mock("eve/channels/linq", async (importOriginal) => {
  const original = await importOriginal<typeof LinqModule>();
  return {
    ...original,
    linqChannel(config: unknown) {
      mocks.config = config;
      return config;
    },
  };
});

await import("../../agent/channels/linq");

const onMessage = (mocks.config as LinqModule.LinqChannelConfig).onMessage;
if (!onMessage) throw new Error("Linq onMessage is not configured.");
const aliceWorkspaceId = accessScopeForUser("better-auth:alice").workspaceId;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopeEnforcementEnabled.mockReturnValue(false);
  mocks.findOne.mockResolvedValue(null);
  mocks.findVerifiedUserByPhoneNumber.mockResolvedValue(undefined);
  mocks.resolveConversationBinding.mockResolvedValue(undefined);
  mocks.createConversationBinding.mockResolvedValue(undefined);
  mocks.recordConnectionInstallation.mockResolvedValue({});
});

describe("Linq channel scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    const result = await onMessage(
      {} as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(result).toMatchObject({
      auth: { attributes: { workspaceId: expect.any(String) } },
    });
    expect(mocks.verifyScopeAccess).not.toHaveBeenCalled();
  });

  it("drops a denied scope while enforcement is on", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue(undefined);

    await expect(
      onMessage(
        {} as never,
        { author: { isBot: false, userName: "+12025550123" } } as never
      )
    ).resolves.toBeNull();
  });

  it("does not resolve conversation bindings while enforcement is off", async () => {
    await onMessage(
      {} as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(mocks.resolveConversationBinding).not.toHaveBeenCalled();
    expect(mocks.createConversationBinding).not.toHaveBeenCalled();
  });

  it("drops an existing binding owned by another workspace", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({
      id: "alice",
      phoneNumberVerified: true,
    });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    mocks.resolveConversationBinding.mockResolvedValue({
      workspaceId: "workspace:other",
    });

    await expect(
      onMessage(
        { thread: { id: "linq:chat-1:dm" } } as never,
        { author: { isBot: false, userName: "+12025550123" } } as never
      )
    ).resolves.toBeNull();
  });

  it("preserves the current behavior when no active agent can create a binding", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({
      id: "alice",
      phoneNumberVerified: true,
    });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });

    await expect(
      onMessage(
        { thread: { id: "linq:chat-1:dm" } } as never,
        { author: { isBot: false, userName: "+12025550123" } } as never
      )
    ).resolves.toMatchObject({
      auth: { attributes: { workspaceId: expect.any(String) } },
    });
    expect(mocks.createConversationBinding).toHaveBeenCalledOnce();
  });

  it("records the Linq installation for a newly bound workspace", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({ id: "alice", phoneNumberVerified: true });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    mocks.createConversationBinding.mockResolvedValue({
      workspaceId: aliceWorkspaceId,
    });

    await onMessage(
      { thread: { id: "linq:chat-1:dm" } } as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(mocks.recordConnectionInstallation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        authorizationSubject: "+12025550999",
        connectorId: "linq/test",
        provider: "linq",
      })
    );
  });

  it("keeps the message when installation recording fails", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({ id: "alice", phoneNumberVerified: true });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    mocks.createConversationBinding.mockResolvedValue({
      workspaceId: aliceWorkspaceId,
    });
    mocks.recordConnectionInstallation.mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(
      onMessage(
        { thread: { id: "linq:chat-1:dm" } } as never,
        { author: { isBot: false, userName: "+12025550123" } } as never
      )
    ).resolves.toMatchObject({
      auth: { attributes: { workspaceId: expect.any(String) } },
    });
  });

  it("does not re-record an installation for an existing binding", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({ id: "alice", phoneNumberVerified: true });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-alice",
      userId: "alice",
    });
    mocks.resolveConversationBinding.mockResolvedValue({
      workspaceId: aliceWorkspaceId,
    });

    await onMessage(
      { thread: { id: "linq:chat-1:dm" } } as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(mocks.recordConnectionInstallation).not.toHaveBeenCalled();
  });

  it("does not attempt a binding when the phone identity belongs to another user", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue({});
    mocks.findOne.mockResolvedValue({
      id: "alice",
      phoneNumberVerified: true,
    });
    mocks.findVerifiedUserByPhoneNumber.mockResolvedValue({
      phoneIdentityId: "identity-bob",
      userId: "bob",
    });

    await onMessage(
      { thread: { id: "linq:chat-1:dm" } } as never,
      { author: { isBot: false, userName: "+12025550123" } } as never
    );

    expect(mocks.resolveConversationBinding).not.toHaveBeenCalled();
    expect(mocks.createConversationBinding).not.toHaveBeenCalled();
  });
});

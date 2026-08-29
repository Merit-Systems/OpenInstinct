import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";

const mocks = vi.hoisted(() => ({
  isSessionOwned:
    vi.fn<(_scope: AccessScope, _sessionId: string) => Promise<boolean>>(),
}));

vi.mock("@/db/services/sessions", () => ({
  isSessionOwned: mocks.isSessionOwned,
}));

import { requireWorkerScope } from "@/agent/subagents/worker/lib/access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSessionOwned.mockResolvedValue(true);
});

describe("worker access", () => {
  it("allows an internal child turn only when its worker and root sessions are owned", async () => {
    const principal = principalFor("better-auth:alice");
    await expect(
      requireWorkerScope({
        session: workerSession({ current: null, initiator: principal }),
      })
    ).resolves.toEqual(accessScopeForUser(principal.principalId));

    expect(mocks.isSessionOwned).toHaveBeenCalledTimes(2);
    expect(mocks.isSessionOwned).toHaveBeenNthCalledWith(
      1,
      accessScopeForUser(principal.principalId),
      "worker-session"
    );
    expect(mocks.isSessionOwned).toHaveBeenNthCalledWith(
      2,
      accessScopeForUser(principal.principalId),
      "root-session"
    );
  });

  it("rejects direct use and unowned worker lineage", async () => {
    const principal = principalFor("better-auth:alice");
    const session = workerSession({ current: principal, initiator: principal });

    await expect(
      requireWorkerScope({ session: { ...session, parent: undefined } })
    ).rejects.toThrow("require a delegated worker");

    mocks.isSessionOwned
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(requireWorkerScope({ session })).rejects.toThrow(
      "does not own this worker session"
    );
  });
});

function principalFor(userId: string) {
  return {
    attributes: { workspaceId: accessScopeForUser(userId).workspaceId },
    authenticator: "test",
    principalId: userId,
    principalType: "user",
  } as const;
}

function workerSession(auth: {
  current: ReturnType<typeof principalFor> | null;
  initiator: ReturnType<typeof principalFor> | null;
}) {
  return {
    auth,
    id: "worker-session",
    parent: {
      callId: "worker-call",
      rootSessionId: "root-session",
      sessionId: "root-session",
      turn: { id: "root-turn", sequence: 0 },
    },
    turn: { id: "worker-turn", sequence: 0 },
  };
}

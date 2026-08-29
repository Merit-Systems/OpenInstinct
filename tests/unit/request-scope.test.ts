import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthSession:
    vi.fn<(_headers: Headers) => Promise<{ user: { id: string } } | null>>(),
  headers: vi.fn<() => Promise<Headers>>(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
  verifyScopeAccess: vi.fn<(_scope: unknown) => Promise<unknown>>(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/session", () => ({ getAuthSession: mocks.getAuthSession }));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScopeAccess,
}));
vi.mock("@/lib/env", () => ({
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getAuthSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.scopeEnforcementEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.resetModules();
});

describe("request scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    const { requireRequestScope } = await import("@/lib/request-scope");

    await expect(requireRequestScope()).resolves.toMatchObject({
      userId: "better-auth:user-1",
    });
    expect(mocks.verifyScopeAccess).not.toHaveBeenCalled();
  });

  it("rejects denied scopes while enforcement is on", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue(undefined);
    const { requireRequestScope, UnauthenticatedError } =
      await import("@/lib/request-scope");

    await expect(requireRequestScope()).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
  });
});

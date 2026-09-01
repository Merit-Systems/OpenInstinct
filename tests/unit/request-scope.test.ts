import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRequireRequestScope,
  UnauthenticatedError,
} from "@/lib/request-scope";
import type { requestScopeDependencies } from "@/lib/request-scope";

const getAuthSession = vi.fn<typeof requestScopeDependencies.getAuthSession>();
const headers = vi.fn<typeof requestScopeDependencies.headers>();
const isWorkspaceScopeEnforcementEnabled =
  vi.fn<typeof requestScopeDependencies.isWorkspaceScopeEnforcementEnabled>();
const verifyScopeAccess =
  vi.fn<typeof requestScopeDependencies.verifyScopeAccess>();
const requireRequestScope = createRequireRequestScope({
  getAuthSession,
  headers,
  isWorkspaceScopeEnforcementEnabled,
  verifyScopeAccess,
});

beforeEach(() => {
  vi.clearAllMocks();
  headers.mockResolvedValue(new Headers());
  getAuthSession.mockResolvedValue({
    user: {
      id: "user-1",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    },
  });
  isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);
});

describe("request scope", () => {
  it("does not verify membership while enforcement is off", async () => {
    await expect(requireRequestScope()).resolves.toMatchObject({
      userId: "better-auth:user-1",
    });
    expect(verifyScopeAccess).not.toHaveBeenCalled();
  });

  it("rejects denied scopes while enforcement is on", async () => {
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(undefined);

    await expect(requireRequestScope()).rejects.toBeInstanceOf(
      UnauthenticatedError
    );
  });
});

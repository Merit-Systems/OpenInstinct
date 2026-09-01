import { headers } from "next/headers";
import { cache } from "react";
import { getAuthSession } from "@/auth/session";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { verifyScopeAccess } from "@/db/services/scope";
import { isWorkspaceScopeEnforcementEnabled } from "@/lib/env";

export const requireRequestScope = cache(async (): Promise<AccessScope> => {
  const session = await getAuthSession(await headers());
  if (!session) throw new UnauthenticatedError();
  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  if (!isWorkspaceScopeEnforcementEnabled()) return scope;

  const verifiedScope = await verifyScopeAccess(scope);
  if (!verifiedScope) throw new UnauthenticatedError();
  return verifiedScope;
});

export class UnauthenticatedError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "UnauthenticatedError";
  }
}

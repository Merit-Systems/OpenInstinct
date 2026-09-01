import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, UnauthenticatedError } from "eve/channels/auth";
import { z } from "zod";
import { isSessionOwned } from "@/db/services/sessions";
import { verifyScopeAccess } from "@/db/services/scope";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { getAuthSession } from "@/auth/session";
import { isWorkspaceScopeEnforcementEnabled } from "@/env";

export default eveChannel({
  auth: [
    async (request) => {
      const identity = await requestIdentityFromRequest(request);
      if (!identity) {
        throw new UnauthenticatedError({
          code: "authentication_required",
          message: "Sign in to continue.",
        });
      }
      const { phoneNumber, scope } = identity;

      const sessionId = sessionIdFromPath(new URL(request.url).pathname);
      if (sessionId && !(await waitForSessionOwnership(scope, sessionId))) {
        throw new ForbiddenError({ message: "Session not found." });
      }

      return {
        attributes: { phoneNumber, workspaceId: scope.workspaceId },
        authenticator: "authjs",
        principalId: scope.userId,
        principalType: "user",
      };
    },
  ],
});

function sessionIdFromPath(pathname: string) {
  const match = /^\/eve\/v1\/session\/([^/]+)/.exec(pathname);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

async function requestIdentityFromRequest(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session) return undefined;
  const phoneNumber = z.string().safeParse(session.user.phoneNumber);
  if (!phoneNumber.success) return undefined;

  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  if (!isWorkspaceScopeEnforcementEnabled()) {
    return { phoneNumber: phoneNumber.data, scope };
  }

  const verifiedScope = await verifyScopeAccess(scope);
  if (!verifiedScope) return undefined;
  return {
    phoneNumber: phoneNumber.data,
    scope: verifiedScope,
  };
}

async function waitForSessionOwnership(scope: AccessScope, sessionId: string) {
  /* oxlint-disable eslint/no-await-in-loop -- Ownership visibility is checked by a bounded sequential retry loop. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return false;
}

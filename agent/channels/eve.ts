import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, UnauthenticatedError } from "eve/channels/auth";
import { isSessionOwned } from "@/db/services/sessions";
import { verifyScopeAccess } from "@/db/services/scope";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { getAuthSession } from "@/auth/session";
import { isWorkspaceScopeEnforcementEnabled } from "@/lib/env";

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
  if (!match?.[1]) return;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return;
  }
}

async function requestIdentityFromRequest(request: Request) {
  const session = await getAuthSession(request.headers);
  const phoneNumber = session?.user.phoneNumber;
  if (!session || typeof phoneNumber !== "string") return;

  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  if (!isWorkspaceScopeEnforcementEnabled()) {
    return { phoneNumber, scope };
  }

  const verifiedScope = await verifyScopeAccess(scope);
  if (!verifiedScope) return;
  return {
    phoneNumber,
    scope: verifiedScope,
  };
}

async function waitForSessionOwnership(scope: AccessScope, sessionId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

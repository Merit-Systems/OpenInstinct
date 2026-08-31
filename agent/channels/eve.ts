import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, localDev } from "eve/channels/auth";
import { isSessionOwned } from "@/db/services/sessions";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { getAuthSession } from "@/auth/session";

const authenticateLocalDev = localDev();

export default eveChannel({
  auth: [
    async (request) => {
      const identity = await requestIdentityFromRequest(request);
      if (!identity) return null;
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
    async (request) => {
      const local = await authenticateLocalDev(request);
      if (!local) return null;

      const scope = accessScopeForUser("better-auth:browser-benchmark");
      const sessionId = sessionIdFromPath(new URL(request.url).pathname);
      if (sessionId && !(await waitForSessionOwnership(scope, sessionId))) {
        throw new ForbiddenError({ message: "Session not found." });
      }

      return {
        ...local,
        attributes: {
          ...local.attributes,
          phoneNumber: "+15555550100",
          workspaceId: scope.workspaceId,
        },
        principalId: scope.userId,
        principalType: "user" as const,
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

  return {
    phoneNumber,
    scope: accessScopeForUser(`better-auth:${session.user.id}`),
  };
}

async function waitForSessionOwnership(scope: AccessScope, sessionId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

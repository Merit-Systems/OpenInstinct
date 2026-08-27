import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  UnauthenticatedError,
  type AuthFn,
} from "eve/channels/auth";
import { isSessionOwned } from "@/db/services/sessions";
import type { AccessScope } from "@/lib/access-scope";
import { sessionIdFromPath } from "@/lib/eve-session-path";
import { requestScopeFromRequest } from "@/lib/server/eve-request-scope";

function applicationAuth(): AuthFn {
  return async (request) => {
    const scope = await requestScopeFromRequest(request);
    if (!scope) {
      throw new UnauthenticatedError({
        code: "authentication_required",
        message: "Sign in to continue.",
      });
    }

    const sessionId = sessionIdFromPath(new URL(request.url).pathname);
    if (sessionId && !(await waitForSessionOwnership(scope, sessionId))) {
      throw new ForbiddenError({ message: "Session not found." });
    }

    return {
      attributes: { workspaceId: scope.workspaceId },
      authenticator: "authjs",
      principalId: scope.userId,
      principalType: "user",
    };
  };
}

export default eveChannel({ auth: [applicationAuth()] });

async function waitForSessionOwnership(scope: AccessScope, sessionId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

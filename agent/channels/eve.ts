import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  UnauthenticatedError,
  type AuthFn,
} from "eve/channels/auth";
import type { AccessScope } from "../../lib/access-scope.js";
import { sessionIdFromPath } from "../../lib/eve-session-path.js";
import { getAppStore } from "../../lib/server/app-store.js";
import { requestScopeFromRequest } from "../../lib/server/eve-request-scope.js";

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
  const store = await getAppStore();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await store.isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

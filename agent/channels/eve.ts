import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  UnauthenticatedError,
  type AuthFn,
} from "eve/channels/auth";
import type { AccessScope } from "../../lib/access-scope.js";
import { sessionIdFromPath } from "../../lib/eve-session-path.js";
import { getEnv } from "../../lib/runtime-env.js";
import { requestScopeFromRequest } from "../../lib/server/eve-request-scope.js";
import { isAgentSessionOwned } from "../../lib/server/workspace-data.js";

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

export default eveChannel({
  auth: [applicationAuth()],
  onMessage(context) {
    const isLocalDebugRequest =
      getEnv().NODE_ENV === "development" &&
      context.eve.request.headers.get("x-eve-debug-direct") === "1";

    return {
      auth: defaultEveAuth(context),
      context: isLocalDebugRequest
        ? [
            "EVE_DEBUG_DIRECT_EXECUTION: This turn came from the local raw debug harness. Execute in the root session. Do not call the agent tool, Workflow, or any subagent. All tool and model events are visible to the developer.",
          ]
        : undefined,
    };
  },
});

async function waitForSessionOwnership(scope: AccessScope, sessionId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isAgentSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, UnauthenticatedError } from "eve/channels/auth";
import { z } from "zod";
import {
  readAutomationById,
  readAutomationRunById,
} from "@/db/services/automations";
import { isSessionOwned } from "@/db/services/sessions";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { verifyAutomationRequest } from "@/lib/automation-auth";
import { getAuthSession } from "@/auth/session";

export default eveChannel({
  auth: [
    async (request) => {
      const automationIdentity = await automationIdentityFromRequest(request);
      if (automationIdentity) return automationIdentity;

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

async function automationIdentityFromRequest(request: Request) {
  const signed = await verifyAutomationRequest(request.headers, "execute");
  if (!signed?.runId) return undefined;
  const [automation, run] = await Promise.all([
    readAutomationById(signed.automationId),
    readAutomationRunById(signed.runId),
  ]);
  const requestedSessionId = sessionIdFromPath(new URL(request.url).pathname);
  if (
    automation?.status !== "active" ||
    automation.revision !== signed.revision ||
    run?.automationId !== automation.id ||
    run.revision !== signed.revision ||
    run.status !== "running" ||
    (requestedSessionId !== undefined &&
      requestedSessionId !== run.eveSessionId)
  ) {
    throw new ForbiddenError({ message: "Automation is no longer active." });
  }
  return {
    attributes: {
      automationId: automation.id,
      phoneNumber: automation.phoneNumber,
      workspaceId: automation.workspaceId,
    },
    authenticator: "automation",
    principalId: automation.createdByUserId,
    principalType: "user" as const,
  };
}

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

  return {
    phoneNumber: phoneNumber.data,
    scope: accessScopeForUser(`better-auth:${session.user.id}`),
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

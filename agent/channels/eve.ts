import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  localDev,
  UnauthenticatedError,
} from "eve/channels/auth";
import { z } from "zod";
import { isSessionOwned } from "@/db/services/sessions";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { getAuthSession } from "@/auth/session";
import { sendMessageToolResultSchema } from "@/agent/lib/send-message";
import {
  finalizeScheduledReportDelivery,
  releaseScheduledReportDelivery,
  scheduledReportFromSession,
} from "@/agent/lib/schedules/report-lifecycle";

const authenticateLocalDev = localDev();

export default eveChannel({
  auth: [
    async (request) => {
      const identity = await requestIdentityFromRequest(request);
      if (!identity) return null;
      const { phoneNumber, scope } = identity;

      await requireOwnedRouteSubject(scope, request);

      return {
        attributes: {
          conversationChannel: "eve",
          phoneNumber,
          workspaceId: scope.workspaceId,
        },
        authenticator: "authjs",
        principalId: scope.userId,
        principalType: "user",
      };
    },
    async (request) => {
      const local = await authenticateLocalDev(request);
      if (!local) return null;

      const scope = accessScopeForUser("better-auth:browser-benchmark");
      await requireOwnedRouteSubject(scope, request);

      return {
        ...local,
        attributes: {
          ...local.attributes,
          conversationChannel: "eve",
          phoneNumber: "+15555550100",
          workspaceId: scope.workspaceId,
        },
        principalId: scope.userId,
        principalType: "user" as const,
      };
    },
    () => {
      throw new UnauthenticatedError({
        code: "authentication_required",
        message: "Sign in to continue.",
      });
    },
  ],
  events: {
    async "action.result"(event, _channel, session) {
      if (
        event.status === "completed" &&
        sendMessageToolResultSchema.safeParse(event.result).success
      ) {
        await finalizeScheduledReportDelivery(session);
      }
    },
    async "message.completed"(event, _channel, session) {
      if (event.finishReason === "tool-calls") return;
      if (scheduledReportFromSession(session)) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "session.completed"(_event, _channel, session) {
      if (scheduledReportFromSession(session)) {
        await finalizeScheduledReportDelivery(session, "suppressed");
      }
    },
    async "turn.cancelled"(_event, _channel, session) {
      await releaseScheduledReportDelivery(
        session,
        "Scheduled result reporting was cancelled."
      );
    },
    async "turn.failed"(event, _channel, session) {
      await releaseScheduledReportDelivery(session, event.message);
    },
  },
});

// Routes without a session subject. Every other eve route must name a session
// this caller owns, either in the path or inside a hook token.
const subjectFreeRoutes = new Set(["/eve/v1/info", "/eve/v1/session"]);

async function requireOwnedRouteSubject(scope: AccessScope, request: Request) {
  const { pathname } = new URL(request.url);
  if (subjectFreeRoutes.has(pathname)) return;
  const sessionId = sessionIdFromPath(pathname);
  if (!sessionId || !(await waitForSessionOwnership(scope, sessionId))) {
    throw new ForbiddenError({ message: "Session not found." });
  }
}

export function sessionIdFromPath(pathname: string) {
  const session = /^\/eve\/v1\/session\/([^/]+)/.exec(pathname)?.[1];
  if (session) return decodePathSegment(session);
  const hookToken =
    /^\/eve\/v1\/(?:callback|connections\/[^/]+\/callback(?:\/[^/]+)?)\/([^/]+)$/.exec(
      pathname
    )?.[1];
  const token = hookToken ? decodePathSegment(hookToken) : undefined;
  return token ? sessionIdFromHookToken(token) : undefined;
}

// Hook tokens are derived from the session id: `eve:session:<id>:inbox`,
// `<id>:turn-control:<n>[:cancel|:inbox]`, and `<id>:auth`.
function sessionIdFromHookToken(token: string) {
  return (
    /^eve:session:([^:]+):inbox$/.exec(token)?.[1] ??
    /^([^:]+):turn-control:\d+(?::(?:cancel|inbox))?$/.exec(token)?.[1] ??
    /^([^:]+):auth$/.exec(token)?.[1]
  );
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isSessionOwned(scope, sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return false;
}

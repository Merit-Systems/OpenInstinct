import {
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import type { AccessScope } from "@/lib/access-scope";
import { env } from "@/lib/env";
import { googleWorkspaceSubject, googleWorkspaceTokenParams } from "./config";

export async function getGoogleWorkspaceConnection(scope: AccessScope) {
  try {
    const response = await getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
    return {
      accountLabel:
        response.name ??
        (typeof response.claims?.email === "string"
          ? response.claims.email
          : null),
      state: "connected" as const,
    };
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      return { accountLabel: null, state: "disconnected" as const };
    }
    return { accountLabel: null, state: "unavailable" as const };
  }
}

export async function startGoogleWorkspaceAuthorization(
  scope: AccessScope,
  callbackUrl: string
) {
  const authorization = await startAuthorization(
    env.GOOGLE_CONNECTOR_UID,
    googleWorkspaceTokenParams(scope.userId),
    { callbackUrl, expiresInMs: 10 * 60_000 }
  );
  return authorization.url;
}

export async function disconnectGoogleWorkspace(scope: AccessScope) {
  await revokeToken(env.GOOGLE_CONNECTOR_UID, {
    subject: googleWorkspaceSubject(scope.userId),
  });
}

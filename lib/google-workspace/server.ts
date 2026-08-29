import {
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import type { AccessScope } from "@/lib/access-scope";
import {
  deleteRevokedConnectionInstallation,
  findConnectionInstallation,
  recordConnectionInstallation,
  revokeConnectionInstallation,
} from "@/db/services/connection-installations";
import { env, isWorkspaceScopeEnforcementEnabled } from "@/lib/env";
import {
  GOOGLE_WORKSPACE_SCOPES,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "./config";

function googleInstallation(scope: AccessScope) {
  return {
    authorizationSubject: JSON.stringify(googleWorkspaceSubject(scope.userId)),
    connectorId: env.GOOGLE_CONNECTOR_UID,
    provider: "google" as const,
  };
}

async function googleWorkspaceInstallationIsRevoked(scope: AccessScope) {
  if (!isWorkspaceScopeEnforcementEnabled()) return;
  try {
    const installation = await findConnectionInstallation(
      scope,
      googleInstallation(scope)
    );
    // First-use is allowed so legacy Connect grants can bootstrap their tenant record.
    return installation?.status === "revoked";
  } catch {
    console.warn("[google-workspace] connection installation lookup failed");
    return false;
  }
}

export async function getGoogleWorkspaceConnection(scope: AccessScope) {
  try {
    if (await googleWorkspaceInstallationIsRevoked(scope)) {
      return { accountLabel: null, state: "disconnected" as const };
    }
    const response = await getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
    if (isWorkspaceScopeEnforcementEnabled()) {
      try {
        await recordConnectionInstallation(scope, {
          ...googleInstallation(scope),
          scopes: GOOGLE_WORKSPACE_SCOPES,
        });
      } catch {
        console.warn(
          "[google-workspace] connection installation recording failed"
        );
      }
    }
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
  if (isWorkspaceScopeEnforcementEnabled()) {
    await deleteRevokedConnectionInstallation(scope, googleInstallation(scope));
  }
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
  if (isWorkspaceScopeEnforcementEnabled()) {
    try {
      await revokeConnectionInstallation(scope, googleInstallation(scope));
    } catch {
      console.warn(
        "[google-workspace] connection installation revocation failed"
      );
    }
  }
}

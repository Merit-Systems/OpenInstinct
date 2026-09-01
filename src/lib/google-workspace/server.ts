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
import { z } from "zod";
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
  if (
    !googleWorkspaceInstallationDependencies.isWorkspaceScopeEnforcementEnabled()
  )
    return;
  try {
    const installation =
      await googleWorkspaceInstallationDependencies.findConnectionInstallation(
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

export const googleWorkspaceServerDependencies = {
  getTokenResponse,
  revokeToken,
  startAuthorization,
};

export const googleWorkspaceInstallationDependencies = {
  deleteRevokedConnectionInstallation,
  findConnectionInstallation,
  isWorkspaceScopeEnforcementEnabled,
  recordConnectionInstallation,
  revokeConnectionInstallation,
};

export async function getGoogleWorkspaceConnection(scope: AccessScope) {
  try {
    if (await googleWorkspaceInstallationIsRevoked(scope)) {
      return { accountLabel: null, state: "disconnected" as const };
    }
    const response = await googleWorkspaceServerDependencies.getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
    if (
      googleWorkspaceInstallationDependencies.isWorkspaceScopeEnforcementEnabled()
    ) {
      try {
        await googleWorkspaceInstallationDependencies.recordConnectionInstallation(
          scope,
          {
            ...googleInstallation(scope),
            scopes: GOOGLE_WORKSPACE_SCOPES,
          }
        );
      } catch {
        console.warn(
          "[google-workspace] connection installation recording failed"
        );
      }
    }
    const email = z.string().safeParse(response.claims?.email);
    return {
      accountLabel: response.name ?? (email.success ? email.data : null),
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
  if (
    googleWorkspaceInstallationDependencies.isWorkspaceScopeEnforcementEnabled()
  ) {
    await googleWorkspaceInstallationDependencies.deleteRevokedConnectionInstallation(
      scope,
      googleInstallation(scope)
    );
  }
  const authorization =
    await googleWorkspaceServerDependencies.startAuthorization(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(scope.userId),
      { callbackUrl, expiresInMs: 10 * 60_000 }
    );
  return authorization.url;
}

export async function disconnectGoogleWorkspace(scope: AccessScope) {
  await googleWorkspaceServerDependencies.revokeToken(
    env.GOOGLE_CONNECTOR_UID,
    {
      subject: googleWorkspaceSubject(scope.userId),
    }
  );
  if (
    googleWorkspaceInstallationDependencies.isWorkspaceScopeEnforcementEnabled()
  ) {
    try {
      await googleWorkspaceInstallationDependencies.revokeConnectionInstallation(
        scope,
        googleInstallation(scope)
      );
    } catch {
      console.warn(
        "[google-workspace] connection installation revocation failed"
      );
    }
  }
}

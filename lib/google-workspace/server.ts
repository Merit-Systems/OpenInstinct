import {
  ConnectorInstallationRequiredError,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  type ConnectAuthorizationOptions,
  type ConnectAuthorizationResponse,
  type ConnectOptions,
  type ConnectTokenParams,
  type ConnectTokenResponse,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import type { AccessScope } from "@/lib/access-scope";
import {
  GOOGLE_WORKSPACE_CONNECTOR,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "./config";

export interface GoogleWorkspaceClient {
  getTokenResponse(
    connector: string,
    params: ConnectTokenParams,
    options?: ConnectOptions
  ): Promise<ConnectTokenResponse>;
  revokeToken(
    connector: string,
    params: { subject: ReturnType<typeof googleWorkspaceSubject> },
    options?: ConnectOptions
  ): Promise<void>;
  startAuthorization(
    connector: string,
    params: ConnectTokenParams,
    options?: ConnectAuthorizationOptions
  ): Promise<ConnectAuthorizationResponse>;
}

const googleWorkspaceClient: GoogleWorkspaceClient = {
  getTokenResponse,
  revokeToken,
  startAuthorization,
};

export async function getGoogleWorkspaceConnection(
  scope: AccessScope,
  client: GoogleWorkspaceClient = googleWorkspaceClient
) {
  try {
    const response = await client.getTokenResponse(
      GOOGLE_WORKSPACE_CONNECTOR,
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
    if (error instanceof ConnectorInstallationRequiredError) {
      return { accountLabel: null, state: "unavailable" as const };
    }
    return { accountLabel: null, state: "unavailable" as const };
  }
}

export async function startGoogleWorkspaceAuthorization(
  scope: AccessScope,
  callbackUrl: string,
  client: GoogleWorkspaceClient = googleWorkspaceClient
) {
  const authorization = await client.startAuthorization(
    GOOGLE_WORKSPACE_CONNECTOR,
    googleWorkspaceTokenParams(scope.userId),
    { callbackUrl, expiresInMs: 10 * 60_000 }
  );
  return authorization.url;
}

export async function disconnectGoogleWorkspace(
  scope: AccessScope,
  client: GoogleWorkspaceClient = googleWorkspaceClient
) {
  await client.revokeToken(GOOGLE_WORKSPACE_CONNECTOR, {
    subject: googleWorkspaceSubject(scope.userId),
  });
}

import { auth } from "@googleapis/gmail";
import { connect, type EveAuthorizationOptions } from "@vercel/connect/eve";
import type { ToolContext } from "eve/tools";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  findConnectionInstallation,
  recordConnectionInstallation,
} from "@/db/services/connection-installations";
import { verifyScopeAccess } from "@/db/services/scope";
import { env, isWorkspaceScopeEnforcementEnabled } from "@/lib/env";
import {
  googleWorkspaceSubject,
  GOOGLE_WORKSPACE_SCOPES,
} from "@/lib/google-workspace/config";

export const googleWorkspaceAuthOptions = {
  connector: env.GOOGLE_CONNECTOR_UID,
  createSubject(principal) {
    if (principal.type !== "user") {
      throw new Error(
        "Google Workspace requires an authenticated OpenInstinct user."
      );
    }
    return googleWorkspaceSubject(principal.id);
  },
  tokenParams: { scopes: [...GOOGLE_WORKSPACE_SCOPES] },
  validate: true,
} satisfies EveAuthorizationOptions;

const googleWorkspaceAuth = connect(googleWorkspaceAuthOptions);

export async function withGoogleAuth<T>(
  ctx: ToolContext,
  execute: (authClient: InstanceType<typeof auth.OAuth2>) => Promise<T>
) {
  let connection:
    | {
        installation: {
          authorizationSubject: string;
          connectorId: string;
          provider: "google";
        };
        scope: ReturnType<typeof scopeFromPrincipal>;
      }
    | undefined;
  if (isWorkspaceScopeEnforcementEnabled()) {
    const caller = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!caller)
      throw new Error("An authenticated workspace user is required.");
    const scope = scopeFromPrincipal(caller);
    if (!(await verifyScopeAccess(scope))) {
      throw new Error("An authenticated workspace user is required.");
    }
    connection = {
      installation: {
        authorizationSubject: JSON.stringify(
          googleWorkspaceSubject(scope.userId)
        ),
        connectorId: env.GOOGLE_CONNECTOR_UID,
        provider: "google" as const,
      },
      scope,
    };
    const existing = await findConnectionInstallation(
      connection.scope,
      connection.installation
    );
    // First-use is allowed so legacy Connect grants can bootstrap their tenant record.
    if (existing?.status === "revoked") {
      throw new Error("Google Workspace connection has been revoked.");
    }
  }
  const { token } = await ctx.getToken(googleWorkspaceAuth);
  if (connection) {
    await recordConnectionInstallation(connection.scope, {
      ...connection.installation,
      scopes: GOOGLE_WORKSPACE_SCOPES,
    });
  }
  const authClient = new auth.OAuth2();
  authClient.setCredentials({ access_token: token });

  try {
    return await execute(authClient);
  } catch (error) {
    if (googleApiErrorStatus(error) === 401) {
      ctx.requireAuth(googleWorkspaceAuth);
    }
    throw error;
  }
}

export function googleApiErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("response" in error)) return;
  const { response } = error;
  if (!response || typeof response !== "object" || !("status" in response)) {
    return;
  }
  return typeof response.status === "number" ? response.status : undefined;
}

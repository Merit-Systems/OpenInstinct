import { auth } from "@googleapis/gmail";
import { connect, type EveAuthorizationOptions } from "@vercel/connect/eve";
import type { ToolContext } from "eve/tools";
import { scopeFromPrincipal } from "@/lib/access-scope";
import {
  findConnectionInstallation,
  recordConnectionInstallation,
} from "@/db/services/connection-installations";
import { verifyScopeAccess } from "@/db/services/scope";
import { z } from "zod";
import { env, isWorkspaceScopeEnforcementEnabled } from "@/env";
import {
  googleWorkspaceSubject,
  googleWorkspaceScopes,
} from "@/lib/google-workspace";

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
  tokenParams: { scopes: [...googleWorkspaceScopes] },
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
        provider: "google",
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
      scopes: googleWorkspaceScopes,
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

const googleApiErrorSchema = z.object({
  response: z.object({ status: z.number() }),
});

export function googleApiErrorStatus(cause: unknown) {
  const result = googleApiErrorSchema.safeParse(cause);
  return result.success ? result.data.response.status : undefined;
}

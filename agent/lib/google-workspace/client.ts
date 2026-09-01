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
import { z } from "zod";
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

export interface GoogleAuthContext {
  readonly caller?: Parameters<typeof scopeFromPrincipal>[0];
  getAccessToken(): Promise<string>;
  requireGoogleAuthorization(): void;
}

export interface GoogleOAuthClient {
  setCredentials(credentials: { readonly access_token: string }): void;
}

export interface GoogleWorkspaceClientDependencies<
  Client extends GoogleOAuthClient,
> {
  readonly connectorId: string;
  createOAuthClient(): Client;
  findConnectionInstallation: typeof findConnectionInstallation;
  isWorkspaceScopeEnforcementEnabled: typeof isWorkspaceScopeEnforcementEnabled;
  recordConnectionInstallation: typeof recordConnectionInstallation;
  verifyScopeAccess: typeof verifyScopeAccess;
}

export const googleWorkspaceClientDependencies: GoogleWorkspaceClientDependencies<
  InstanceType<typeof auth.OAuth2>
> = {
  connectorId: env.GOOGLE_CONNECTOR_UID,
  createOAuthClient() {
    return new auth.OAuth2();
  },
  findConnectionInstallation,
  isWorkspaceScopeEnforcementEnabled,
  recordConnectionInstallation,
  verifyScopeAccess,
};

export function createWithGoogleAuth<Client extends GoogleOAuthClient>(
  dependencies: GoogleWorkspaceClientDependencies<Client>
) {
  return async function withGoogleAuth<T>(
    context: GoogleAuthContext,
    execute: (authClient: Client) => Promise<T>
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
    if (dependencies.isWorkspaceScopeEnforcementEnabled()) {
      const caller = context.caller;
      if (!caller)
        throw new Error("An authenticated workspace user is required.");
      const scope = scopeFromPrincipal(caller);
      if (!(await dependencies.verifyScopeAccess(scope))) {
        throw new Error("An authenticated workspace user is required.");
      }
      connection = {
        installation: {
          authorizationSubject: JSON.stringify(
            googleWorkspaceSubject(scope.userId)
          ),
          connectorId: dependencies.connectorId,
          provider: "google",
        },
        scope,
      };
      const existing = await dependencies.findConnectionInstallation(
        connection.scope,
        connection.installation
      );
      // First-use is allowed so legacy Connect grants can bootstrap their tenant record.
      if (existing?.status === "revoked") {
        throw new Error("Google Workspace connection has been revoked.");
      }
    }
    const token = await context.getAccessToken();
    if (connection) {
      await dependencies.recordConnectionInstallation(connection.scope, {
        ...connection.installation,
        scopes: googleWorkspaceScopes,
      });
    }
    const authClient = dependencies.createOAuthClient();
    authClient.setCredentials({ access_token: token });

    try {
      return await execute(authClient);
    } catch (error) {
      if (googleApiErrorStatus(error) === 401) {
        context.requireGoogleAuthorization();
      }
      throw error;
    }
  };
}

const runWithGoogleAuth = createWithGoogleAuth<
  InstanceType<typeof auth.OAuth2>
>(googleWorkspaceClientDependencies);

export async function withGoogleAuth<T>(
  ctx: ToolContext,
  execute: (authClient: InstanceType<typeof auth.OAuth2>) => Promise<T>
) {
  return runWithGoogleAuth(
    {
      caller:
        ctx.session.auth.current ?? ctx.session.auth.initiator ?? undefined,
      async getAccessToken() {
        const { token } = await ctx.getToken(googleWorkspaceAuth);
        return token;
      },
      requireGoogleAuthorization() {
        ctx.requireAuth(googleWorkspaceAuth);
      },
    },
    execute
  );
}

const googleApiErrorSchema = z.object({
  response: z.object({ status: z.number() }),
});

export function googleApiErrorStatus(cause: unknown) {
  const result = googleApiErrorSchema.safeParse(cause);
  return result.success ? result.data.response.status : undefined;
}

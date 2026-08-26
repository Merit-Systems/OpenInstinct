import { headers } from "next/headers";
import {
  accessScopeForUser,
  type AccessScope,
  localAccessScope,
} from "@/lib/access-scope";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { getHostedAuthSession } from "@/lib/server/auth-session";

export async function requireRequestScope(): Promise<AccessScope> {
  if (getDeploymentMode() === "local") return localAccessScope;

  const session = await getHostedAuthSession(await headers());
  if (!session) throw new UnauthenticatedError();
  return accessScopeForUser(`better-auth:${session.user.id}`);
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "UnauthenticatedError";
  }
}

export function unauthorizedResponse() {
  return Response.json({ error: "Sign in to continue." }, { status: 401 });
}

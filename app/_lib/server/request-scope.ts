import { headers } from "next/headers";
import { accessScopeForUser, type AccessScope } from "@/lib/access-scope";
import { getAuthSession } from "@/lib/auth/session";

export async function requireRequestScope(): Promise<AccessScope> {
  const session = await getAuthSession(await headers());
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

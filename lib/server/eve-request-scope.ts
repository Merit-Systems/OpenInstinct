import { accessScopeForUser, type AccessScope } from "../access-scope";
import { getAuthSession } from "./auth-session";

export async function requestScopeFromRequest(
  request: Request
): Promise<AccessScope | undefined> {
  const session = await getAuthSession(request.headers);
  return session
    ? accessScopeForUser(`better-auth:${session.user.id}`)
    : undefined;
}

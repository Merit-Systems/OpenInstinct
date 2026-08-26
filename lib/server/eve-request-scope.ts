import {
  accessScopeForUser,
  type AccessScope,
  localAccessScope,
} from "../access-scope";
import { getDeploymentMode } from "../deployment-mode";
import { isLocalManagerHostname } from "../manager";
import { getHostedAuthSession } from "./auth-session";

export async function requestScopeFromRequest(
  request: Request
): Promise<AccessScope | undefined> {
  if (getDeploymentMode() === "local") {
    return isLocalManagerHostname(new URL(request.url).hostname)
      ? localAccessScope
      : undefined;
  }

  const session = await getHostedAuthSession(request.headers);
  return session
    ? accessScopeForUser(`better-auth:${session.user.id}`)
    : undefined;
}

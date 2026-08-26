import { getToken } from "next-auth/jwt";
import { z } from "zod";
import {
  accessScopeForUser,
  type AccessScope,
  localAccessScope,
} from "../access-scope";
import { getDeploymentMode } from "../deployment-mode";
import { isLocalManagerHostname } from "../manager";
import { getEnv } from "../runtime-env";

export async function requestScopeFromRequest(
  request: Request
): Promise<AccessScope | undefined> {
  if (getDeploymentMode() === "local") {
    return isLocalManagerHostname(new URL(request.url).hostname)
      ? localAccessScope
      : undefined;
  }

  const secret = getEnv().AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required in hosted mode.");
  }

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const secureCookie =
    forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
  const token = await getToken({ req: request, secret, secureCookie });
  const userId = z.string().min(1).safeParse(token?.appUserId);
  return userId.success ? accessScopeForUser(userId.data) : undefined;
}

import { z } from "zod";
import { auth, ensureAuthDatabase } from "@/auth";
import { isFullyAuthenticatedUser } from "@/lib/auth-user";
import { getDeploymentMode } from "@/lib/deployment-mode";
import { isAllowedMutationOrigin } from "@/lib/manager";

const enrollmentSchema = z.object({ password: z.string().min(12).max(128) });

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (getDeploymentMode() === "local") {
    return Response.json(
      { error: "Authentication is disabled locally." },
      { status: 404 }
    );
  }
  if (!hasAllowedOrigin(request)) {
    return Response.json(
      { error: "Cross-origin writes are blocked." },
      { status: 403 }
    );
  }

  await ensureAuthDatabase();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.phoneNumberVerified || !session.user.phoneNumber) {
    return Response.json(
      { error: "Verify your phone number first." },
      { status: 401 }
    );
  }
  if (isFullyAuthenticatedUser(session.user)) {
    return Response.json(
      { status: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const { password } = enrollmentSchema.parse(await request.json());
  const accounts = await auth.api.listUserAccounts({
    headers: request.headers,
  });
  if (accounts.some((account) => account.providerId === "credential")) {
    await auth.api.verifyPassword({
      body: { password },
      headers: request.headers,
    });
  } else {
    await auth.api.setPassword({
      body: { newPassword: password },
      headers: request.headers,
    });
  }
  const enabled = await auth.api.enableTwoFactor({
    body: { method: "otp", password },
    headers: request.headers,
    returnHeaders: true,
  });

  enabled.headers.set("Cache-Control", "no-store");
  return Response.json({ status: true }, { headers: enabled.headers });
}

function hasAllowedOrigin(request: Request) {
  if (!request.headers.get("origin")) return false;
  return isAllowedMutationOrigin({
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    requestUrl: request.url,
  });
}

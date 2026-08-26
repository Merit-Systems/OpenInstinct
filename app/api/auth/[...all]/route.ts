import { toNextJsHandler } from "better-auth/next-js";
import { z } from "zod";
import { auth, ensureAuthDatabase } from "@/auth";
import { getDeploymentMode } from "@/lib/deployment-mode";

const handlers = toNextJsHandler(auth);
const trustedDeviceSchema = z.object({ trustDevice: z.literal(true) });

export const GET = withHostedAuth(handlers.GET);
export const POST = withHostedAuth(handlers.POST);

function withHostedAuth(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    if (getDeploymentMode() === "local") {
      return Response.json(
        { error: "Authentication is disabled locally." },
        { status: 404 }
      );
    }
    if (await requestsTrustedDevice(request)) {
      return Response.json(
        { error: "Trusted devices are not enabled." },
        { status: 400 }
      );
    }
    await ensureAuthDatabase();
    return handler(request);
  };
}

async function requestsTrustedDevice(request: Request) {
  if (
    request.method !== "POST" ||
    !new URL(request.url).pathname.endsWith("/two-factor/verify-otp")
  ) {
    return false;
  }

  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  return trustedDeviceSchema.safeParse(body).success;
}

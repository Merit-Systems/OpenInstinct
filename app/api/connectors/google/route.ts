import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/app/_lib/server/request-scope";
import { googleWorkspaceActionSchema } from "@/lib/google-workspace/config";
import {
  disconnectGoogleWorkspace,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import { isAllowedMutationOrigin } from "@/lib/manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const scope = await requireRequestScope();
    if (!isAllowedMutationOrigin(originCheckInput(request))) {
      return Response.json(
        { error: "Cross-origin connection writes are blocked." },
        { status: 403 }
      );
    }

    const form = await request.formData();
    const action = googleWorkspaceActionSchema.parse(form.get("action"));
    const returnUrl = new URL("/", request.url);

    if (action === "connect") {
      returnUrl.searchParams.set("google", "connected");
      const authorizationUrl = await startGoogleWorkspaceAuthorization(
        scope,
        returnUrl.toString()
      );
      return sensitiveRedirect(authorizationUrl);
    }

    await disconnectGoogleWorkspace(scope);
    returnUrl.searchParams.set("google", "disconnected");
    return sensitiveRedirect(returnUrl);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    const returnUrl = new URL("/", request.url);
    returnUrl.searchParams.set("google", "unavailable");
    return sensitiveRedirect(returnUrl);
  }
}

function originCheckInput(request: Request) {
  return {
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    requestUrl: request.url,
  };
}

function sensitiveRedirect(url: string | URL) {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Expires: "0",
      Location: url.toString(),
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
    },
    status: 303,
  });
}

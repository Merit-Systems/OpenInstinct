import {
  isAllowedManagerMutationOrigin,
  isAllowedMutationOrigin,
  isLocalManagerHostname,
  managerMutationSchema,
} from "@/lib/manager";
import { getEnv } from "@/lib/runtime-env";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/lib/server/request-scope";
import {
  applyManagerMutation,
  readManagerSnapshot,
} from "@/lib/server/manager-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = await requireRequestScope();
    const denied = denyRequest(request, scope.mode);
    if (denied) return denied;
    return Response.json(await readManagerSnapshot(scope), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    return managerError(
      error instanceof Error ? error.message : "Manager request failed."
    );
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireRequestScope();
    const denied = denyRequest(request, scope.mode, true);
    if (denied) return denied;
    const mutation = managerMutationSchema.parse(await request.json());
    return Response.json(await applyManagerMutation(scope, mutation), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    return managerError(
      error instanceof Error ? error.message : "Manager request failed."
    );
  }
}

function denyRequest(
  request: Request,
  mode: "hosted" | "local",
  mutation = false
) {
  const url = new URL(request.url);
  const remoteLocalManagerAllowed =
    mode === "local" && getEnv().LOCAL_VAULT_ASSISTANT_ALLOW_REMOTE_MANAGER;
  if (
    mode === "local" &&
    !remoteLocalManagerAllowed &&
    !isLocalManagerHostname(url.hostname)
  ) {
    return Response.json(
      { error: "The local manager is available only on this device." },
      { status: 403 }
    );
  }

  if (mutation) {
    if (
      !(
        mode === "local" && !remoteLocalManagerAllowed
          ? isAllowedManagerMutationOrigin
          : isAllowedMutationOrigin
      )({
        forwardedHost: request.headers.get("x-forwarded-host"),
        forwardedProto: request.headers.get("x-forwarded-proto"),
        host: request.headers.get("host"),
        origin: request.headers.get("origin"),
        requestUrl: request.url,
      })
    ) {
      return Response.json(
        { error: "Cross-origin manager writes are blocked." },
        { status: 403 }
      );
    }
  }
}

function managerError(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

import {
  isAllowedManagerMutationOrigin,
  isLocalManagerHostname,
  managerMutationSchema,
} from "@/lib/manager";
import { getEnv } from "@/lib/runtime-env";
import {
  applyManagerMutation,
  readManagerSnapshot,
} from "@/lib/server/manager-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = denyNonLocalRequest(request);
  if (denied) return denied;

  try {
    return Response.json(await readManagerSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return managerError(
      error instanceof Error ? error.message : "Manager request failed."
    );
  }
}

export async function POST(request: Request) {
  const denied = denyNonLocalRequest(request, true);
  if (denied) return denied;

  try {
    const mutation = managerMutationSchema.parse(await request.json());
    return Response.json(await applyManagerMutation(mutation), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return managerError(
      error instanceof Error ? error.message : "Manager request failed."
    );
  }
}

function denyNonLocalRequest(request: Request, mutation = false) {
  if (getEnv().LOCAL_VAULT_ASSISTANT_ALLOW_REMOTE_MANAGER) return;

  const url = new URL(request.url);
  if (!isLocalManagerHostname(url.hostname)) {
    return Response.json(
      { error: "The local manager is available only on this device." },
      { status: 403 }
    );
  }

  if (mutation) {
    if (
      !isAllowedManagerMutationOrigin({
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

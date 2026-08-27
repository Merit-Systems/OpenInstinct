import { isAllowedMutationOrigin, managerMutationSchema } from "@/lib/manager";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/app/_lib/server/request-scope";
import {
  applyManagerMutation,
  readManagerSnapshot,
} from "@/lib/manager/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const scope = await requireRequestScope();
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
    const denied = denyCrossOriginMutation(request);
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

function denyCrossOriginMutation(request: Request) {
  if (!isAllowedMutationOrigin(originCheckInput(request))) {
    return Response.json(
      { error: "Cross-origin manager writes are blocked." },
      { status: 403 }
    );
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

function managerError(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

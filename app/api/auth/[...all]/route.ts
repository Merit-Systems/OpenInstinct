import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthDatabase } from "@/auth";
import { getDeploymentMode } from "@/lib/deployment-mode";

const handlers = toNextJsHandler(auth);

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
    await ensureAuthDatabase();
    return handler(request);
  };
}

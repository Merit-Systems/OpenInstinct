import { TRPCError } from "@trpc/server";
import { requireRequestScope, UnauthenticatedError } from "@/lib/request-scope";
import { isSameOrigin } from "@/lib/same-origin";

export async function createHTTPContext(
  request: Request,
  getScope = requireRequestScope
) {
  if (request.method !== "GET" && !isSameOrigin(request)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  try {
    return {
      origin: new URL(request.url).origin,
      scope: await getScope(),
    };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    throw error;
  }
}

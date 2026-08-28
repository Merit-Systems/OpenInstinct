import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthDatabase } from "@/auth";

const handlers = toNextJsHandler(auth);

export const GET = withAuthDatabase(handlers.GET);
export const POST = withAuthDatabase(handlers.POST);

function withAuthDatabase(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    ensureAuthDatabase();
    return handler(request);
  };
}

import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";

let handlersPromise: Promise<ReturnType<typeof toNextJsHandler>> | undefined;

function getHandlers() {
  handlersPromise ??= getAuth()
    .then((auth) => toNextJsHandler(auth))
    .catch((error: unknown) => {
      handlersPromise = undefined;
      throw error;
    });
  return handlersPromise;
}

export async function GET(request: Request) {
  return (await getHandlers()).GET(request);
}

export async function POST(request: Request) {
  return (await getHandlers()).POST(request);
}

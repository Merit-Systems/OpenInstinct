import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";

export const authRouteDependencies = {
  async loadHandlers() {
    return toNextJsHandler(await getAuth());
  },
};

let handlersPromise:
  | ReturnType<typeof authRouteDependencies.loadHandlers>
  | undefined;

function getHandlers() {
  handlersPromise ??= loadHandlersWithRetry();
  return handlersPromise;
}

async function loadHandlersWithRetry() {
  try {
    return await authRouteDependencies.loadHandlers();
  } catch (error) {
    handlersPromise = undefined;
    throw error;
  }
}

export async function GET(request: Request) {
  return (await getHandlers()).GET(request);
}

export async function POST(request: Request) {
  return (await getHandlers()).POST(request);
}

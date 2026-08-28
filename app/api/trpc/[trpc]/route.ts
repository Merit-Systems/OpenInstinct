import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createHTTPContext } from "@/trpc/http-context";
import { appRouter } from "@/trpc/router";

const handler = (request: Request) =>
  fetchRequestHandler({
    createContext: () => createHTTPContext(request),
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
  });

export { handler as GET, handler as POST };

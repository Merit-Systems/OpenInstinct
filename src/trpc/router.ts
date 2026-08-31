import { z } from "zod";
import { readModelCatalog } from "@/lib/model-catalog/server";
import { listBrowserTraces } from "@/db/services/browser-traces";
import { saveChat } from "@/db/services/chats";
import { saveChatSchema } from "@/lib/chat";
import { googleWorkspaceActionSchema } from "@/lib/google-workspace/config";
import {
  disconnectGoogleWorkspace,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import { managerMutationSchema, managerSnapshotSchema } from "@/lib/manager";
import { applyManagerMutation } from "@/lib/manager/server/store";
import { createTRPCRouter, protectedProcedure } from "./init";

export const routerDependencies = {
  applyManagerMutation,
  disconnectGoogleWorkspace,
  listBrowserTraces,
  readModelCatalog,
  saveChat,
  startGoogleWorkspaceAuthorization,
};

export const appRouter = createTRPCRouter({
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) =>
        routerDependencies.saveChat(ctx.scope, input)
      ),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(googleWorkspaceActionSchema)
      .mutation(async ({ ctx, input }) => {
        if (input === "disconnect") {
          await routerDependencies.disconnectGoogleWorkspace(ctx.scope);
          return { redirectTo: "/?google=disconnected" };
        }

        const callbackUrl = new URL("/", ctx.origin);
        callbackUrl.searchParams.set("google", "connected");
        return {
          redirectTo:
            await routerDependencies.startGoogleWorkspaceAuthorization(
              ctx.scope,
              callbackUrl.toString()
            ),
        };
      }),
  },
  manager: {
    mutate: protectedProcedure
      .input(managerMutationSchema)
      .output(managerSnapshotSchema)
      .mutation(({ ctx, input }) =>
        routerDependencies.applyManagerMutation(ctx.scope, input)
      ),
  },
  models: {
    list: protectedProcedure.query(routerDependencies.readModelCatalog),
  },
  traces: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        routerDependencies.listBrowserTraces(
          ctx.scope,
          input.cursor ?? undefined
        )
      ),
  },
});

export type AppRouter = typeof appRouter;

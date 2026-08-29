import { z } from "zod";
import { readModelCatalog } from "@/lib/model-catalog/server";
import { readTaskHistoryPage } from "@/lib/task-history/server";
import { saveChat } from "@/db/services/chats";
import { saveChatSchema } from "@/lib/chat";
import { googleWorkspaceActionSchema } from "@/lib/google-workspace/config";
import {
  disconnectGoogleWorkspace,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";
import { managerMutationSchema, managerSnapshotSchema } from "@/lib/manager";
import { applyManagerMutation } from "@/lib/manager/server/store";
import {
  listApiCredentials,
  mintApiCredential,
  revokeApiCredential,
} from "@/db/services/api-credentials";
import {
  disableWebhookEndpoint,
  listWebhookEndpoints,
  registerWebhookEndpoint,
  rotateWebhookSecret,
} from "@/db/services/webhooks";
import { createTRPCRouter, protectedProcedure } from "./init";

export const appRouter = createTRPCRouter({
  apiCredentials: {
    list: protectedProcedure.query(({ ctx }) => listApiCredentials(ctx.scope)),
    mint: protectedProcedure
      .input(
        z.object({
          name: z.string(),
          scopes: z
            .array(z.enum(["agents:read", "agents:write", "usage:read"]))
            .min(1),
          expiresAt: z.iso.datetime().optional(),
        })
      )
      .mutation(({ ctx, input }) => mintApiCredential(ctx.scope, input)),
    revoke: protectedProcedure
      .input(z.object({ credentialId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        revokeApiCredential(ctx.scope, input.credentialId)
      ),
  },
  webhookEndpoints: {
    list: protectedProcedure.query(({ ctx }) =>
      listWebhookEndpoints(ctx.scope)
    ),
    register: protectedProcedure
      .input(
        z.object({
          url: z.string(),
          subscribedEvents: z.array(z.string()).min(1),
        })
      )
      .mutation(({ ctx, input }) => registerWebhookEndpoint(ctx.scope, input)),
    disable: protectedProcedure
      .input(z.object({ endpointId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        disableWebhookEndpoint(ctx.scope, input.endpointId)
      ),
    rotate: protectedProcedure
      .input(z.object({ endpointId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        rotateWebhookSecret(ctx.scope, input.endpointId)
      ),
  },
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(googleWorkspaceActionSchema)
      .mutation(async ({ ctx, input }) => {
        if (input === "disconnect") {
          await disconnectGoogleWorkspace(ctx.scope);
          return { redirectTo: "/?google=disconnected" };
        }

        const callbackUrl = new URL("/", ctx.origin);
        callbackUrl.searchParams.set("google", "connected");
        return {
          redirectTo: await startGoogleWorkspaceAuthorization(
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
      .mutation(({ ctx, input }) => applyManagerMutation(ctx.scope, input)),
  },
  models: {
    list: protectedProcedure.query(readModelCatalog),
  },
  tasks: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        readTaskHistoryPage(ctx.scope, input.cursor ?? undefined)
      ),
  },
});

export type AppRouter = typeof appRouter;

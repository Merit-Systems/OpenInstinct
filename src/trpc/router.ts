import { gateway } from "ai";
import { revokeToken, startAuthorization } from "@vercel/connect";
import { z } from "zod";
import { listBrowserTraces } from "@/db/services/browser-traces";
import { saveChat } from "@/db/services/chats";
import { selectGatewayModel } from "@/db/services/settings";
import { deleteVaultItem, saveVaultItem } from "@/db/services/vault";
import type { AccessScope } from "@/lib/access-scope";
import { saveChatSchema } from "@/lib/chat";
import { env } from "@/lib/env";
import {
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@/lib/google-workspace";
import { vaultCreateItemSchema, vaultImportItemsSchema } from "@/lib/vault";
import { createTRPCRouter, protectedProcedure } from "./init";

export const appRouter = createTRPCRouter({
  chats: {
    save: protectedProcedure
      .input(saveChatSchema)
      .mutation(({ ctx, input }) => saveChat(ctx.scope, input)),
  },
  googleWorkspace: {
    update: protectedProcedure
      .input(z.enum(["connect", "disconnect"]))
      .mutation(async ({ ctx, input }) => {
        if (input === "disconnect") {
          await revokeToken(env.GOOGLE_CONNECTOR_UID, {
            subject: googleWorkspaceSubject(ctx.scope.userId),
          });
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
  settings: {
    selectModel: protectedProcedure
      .input(z.object({ modelId: z.string().trim().min(1).max(300) }))
      .mutation(({ ctx, input }) =>
        selectGatewayModel(ctx.scope, input.modelId)
      ),
  },
  traces: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        listBrowserTraces(ctx.scope, input.cursor ?? undefined)
      ),
  },
  vault: {
    create: protectedProcedure
      .input(vaultCreateItemSchema)
      .mutation(({ ctx, input }) => saveVaultItem(ctx.scope, input)),
    import: protectedProcedure
      .input(vaultImportItemsSchema)
      .mutation(async ({ ctx, input }) => {
        for (const item of input) await saveVaultItem(ctx.scope, item);
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => deleteVaultItem(ctx.scope, input.id)),
  },
  models: {
    list: protectedProcedure.query(readModelCatalog),
  },
});

export type AppRouter = typeof appRouter;

async function startGoogleWorkspaceAuthorization(
  scope: AccessScope,
  callbackUrl: string
) {
  const authorization = await startAuthorization(
    env.GOOGLE_CONNECTOR_UID,
    googleWorkspaceTokenParams(scope.userId),
    { callbackUrl, expiresInMs: 10 * 60_000 }
  );
  return authorization.url;
}

async function readModelCatalog() {
  const { models } = await gateway.getAvailableModels();

  return z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownedBy: z.string(),
        pricing: z
          .object({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
          })
          .optional(),
      })
    )
    .parse(
      models
        .filter((model) => model.modelType === "language")
        .map((model) => ({
          id: model.id,
          name: model.name,
          ownedBy: model.specification.provider,
          pricing: model.pricing
            ? {
                input: perMillion(model.pricing.input),
                output: perMillion(model.pricing.output),
              }
            : undefined,
        }))
    );
}

function perMillion(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

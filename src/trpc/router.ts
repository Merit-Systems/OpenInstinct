import { gateway } from "ai";
import { z } from "zod";
import { createWorld } from "@workflow/world-vercel";
import { revokeToken, startAuthorization } from "@vercel/connect";
import { saveChat } from "@/db/services/chats";
import { listOwnedSessionIds } from "@/db/services/sessions";
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

const taskHistoryPageSize = 25;
const taskHistoryWorkflowName = "workflow//eve//workflowEntry";

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
  tasks: {
    list: protectedProcedure
      .input(z.object({ cursor: z.string().nullish() }))
      .query(({ ctx, input }) =>
        readTaskHistoryPage(ctx.scope, input.cursor ?? undefined)
      ),
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

export async function readTaskHistoryPage(scope: AccessScope, cursor?: string) {
  const ownedSessionIds = await listOwnedSessionIds(scope);
  const world = createWorld({
    headers: { "User-Agent": "local-vault-assistant/task-history" },
  });
  const runs: Awaited<ReturnType<typeof world.runs.list>>["data"][number][] =
    [];
  let nextCursor = cursor;
  let hasMore = true;
  let pagesRead = 0;

  while (runs.length < taskHistoryPageSize && hasMore && pagesRead < 10) {
    const page = await world.runs.list({
      pagination: {
        cursor: nextCursor,
        limit: taskHistoryPageSize - runs.length,
        sortOrder: "desc",
      },
      resolveData: "none",
      workflowName: taskHistoryWorkflowName,
    });
    runs.push(
      ...page.data.filter(
        (run) =>
          run.attributes["$eve.type"] === "session" &&
          ownedSessionIds.has(run.runId)
      )
    );
    nextCursor = page.cursor ?? undefined;
    hasMore = page.hasMore;
    pagesRead += 1;
  }

  return {
    cursor: nextCursor ?? null,
    hasMore,
    runs: runs.map((run) => ({
      createdAt: run.createdAt.toISOString(),
      prompt: run.attributes["$eve.title"] ?? "Untitled task",
      sessionId: run.runId,
      status: taskHistoryStatus(run.status),
      updatedAt: run.updatedAt.toISOString(),
    })),
  };
}

function taskHistoryStatus(status: string) {
  switch (status) {
    case "cancelled":
    case "completed":
    case "failed":
    case "pending":
    case "running":
      return status;
    default:
      return "failed";
  }
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

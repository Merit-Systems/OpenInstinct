import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { chatListSchema, type ChatSummary, type SaveChat } from "@/lib/chat";
import { chats, db } from "@/db";
import { ensureScope } from "./scope";

const chatRowSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  createdAt: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string(),
});

function toChatSummary(row: z.infer<typeof chatRowSchema>): ChatSummary {
  const { costUsd, inputTokens, outputTokens, ...chat } = row;
  return {
    ...chat,
    usage: { costUsd, inputTokens, outputTokens },
  };
}

export async function listChats(scope: AccessScope) {
  const rows = chatRowSchema
    .array()
    .parse(
      await db
        .select()
        .from(chats)
        .where(eq(chats.workspaceId, scope.workspaceId))
        .orderBy(desc(chats.updatedAt))
    );
  return chatListSchema.parse(rows.map(toChatSummary));
}

export async function readChat(scope: AccessScope, sessionId: string) {
  const rows = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.workspaceId, scope.workspaceId),
        eq(chats.sessionId, sessionId)
      )
    )
    .limit(1);
  const row = chatRowSchema.optional().parse(rows[0]);
  return row ? toChatSummary(row) : undefined;
}

export async function saveChat(scope: AccessScope, chat: SaveChat) {
  await ensureScope(scope);
  const now = new Date().toISOString();
  const existing = await db
    .select({ sessionId: chats.sessionId })
    .from(chats)
    .where(
      and(
        eq(chats.workspaceId, scope.workspaceId),
        eq(chats.sessionId, chat.sessionId)
      )
    );
  if (existing.length === 0) {
    await db.insert(chats).values({
      costUsd: chat.usage?.costUsd ?? null,
      createdAt: now,
      inputTokens: chat.usage?.inputTokens ?? 0,
      outputTokens: chat.usage?.outputTokens ?? 0,
      sessionId: chat.sessionId,
      title: chat.title ?? "New chat",
      updatedAt: now,
      workspaceId: scope.workspaceId,
    });
    return;
  }
  await db
    .update(chats)
    .set({
      ...(chat.title === undefined ? {} : { title: chat.title }),
      ...(chat.usage === undefined
        ? {}
        : {
            costUsd: chat.usage.costUsd,
            inputTokens: chat.usage.inputTokens,
            outputTokens: chat.usage.outputTokens,
          }),
      updatedAt: now,
    })
    .where(
      and(
        eq(chats.workspaceId, scope.workspaceId),
        eq(chats.sessionId, chat.sessionId)
      )
    );
}

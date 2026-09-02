import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { chatListSchema, type ChatSummary, type SaveChat } from "@/lib/chat";
import { agentSessions, chats, db } from "@/db";
import { ensureScope } from "./scope";

const chatRowSchema = z.object({
  costUsd: z.number().nonnegative().nullable(),
  createdAt: z.coerce.date(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.coerce.date(),
});

function toChatSummary(row: z.infer<typeof chatRowSchema>): ChatSummary {
  const { costUsd, createdAt, inputTokens, outputTokens, updatedAt, ...chat } =
    row;
  return {
    ...chat,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    usage: { costUsd, inputTokens, outputTokens },
  };
}

export async function listChats(scope: AccessScope) {
  const updatedAt = sql<Date>`coalesce(${chats.updatedAt}, ${agentSessions.createdAt})`;
  const rows = chatRowSchema.array().parse(
    await db
      .select({
        costUsd: chats.costUsd,
        createdAt: sql<Date>`coalesce(${chats.createdAt}, ${agentSessions.createdAt})`,
        inputTokens: sql<number>`coalesce(${chats.inputTokens}, 0)`,
        outputTokens: sql<number>`coalesce(${chats.outputTokens}, 0)`,
        sessionId: agentSessions.sessionId,
        title: sql<string>`coalesce(${chats.title}, 'New chat')`,
        updatedAt,
      })
      .from(agentSessions)
      .leftJoin(chats, eq(chats.sessionId, agentSessions.sessionId))
      .where(eq(agentSessions.workspaceId, scope.workspaceId))
      .orderBy(desc(updatedAt))
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
  const now = new Date();
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
  const updates: Partial<typeof chats.$inferInsert> = { updatedAt: now };
  if (chat.title !== undefined) updates.title = chat.title;
  if (chat.usage !== undefined) {
    updates.costUsd = chat.usage.costUsd;
    updates.inputTokens = chat.usage.inputTokens;
    updates.outputTokens = chat.usage.outputTokens;
  }
  await db
    .update(chats)
    .set(updates)
    .where(
      and(
        eq(chats.workspaceId, scope.workspaceId),
        eq(chats.sessionId, chat.sessionId)
      )
    );
}

import { and, desc, eq, sql } from "drizzle-orm";
import type { AccessScope } from "../access-scope";
import type { ChatSummary, SaveChat } from "../chat";
import { chats } from "../db/schema";
import { database } from "./database";

export async function listChats(scope: AccessScope): Promise<ChatSummary[]> {
  const rows = await database()
    .select()
    .from(chats)
    .where(eq(chats.workspaceId, scope.workspaceId))
    .orderBy(desc(chats.updatedAt));
  return rows.map(toChatSummary);
}

export async function readChat(scope: AccessScope, sessionId: string) {
  const row = await database().query.chats.findFirst({
    where: and(
      eq(chats.workspaceId, scope.workspaceId),
      eq(chats.sessionId, sessionId)
    ),
  });
  return row ? toChatSummary(row) : undefined;
}

export async function saveChat(scope: AccessScope, chat: SaveChat) {
  const now = new Date().toISOString();
  const rows = await database()
    .insert(chats)
    .values({
      costUsd: chat.usage?.costUsd ?? null,
      createdAt: now,
      inputTokens: chat.usage?.inputTokens ?? 0,
      outputTokens: chat.usage?.outputTokens ?? 0,
      sessionId: chat.sessionId,
      title: chat.title ?? "New chat",
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      set: {
        costUsd:
          chat.usage === undefined ? sql`${chats.costUsd}` : chat.usage.costUsd,
        inputTokens:
          chat.usage === undefined
            ? sql`${chats.inputTokens}`
            : chat.usage.inputTokens,
        outputTokens:
          chat.usage === undefined
            ? sql`${chats.outputTokens}`
            : chat.usage.outputTokens,
        title: chat.title ?? sql`${chats.title}`,
        updatedAt: now,
      },
      setWhere: eq(chats.workspaceId, scope.workspaceId),
      target: chats.sessionId,
    })
    .returning({ sessionId: chats.sessionId });
  if (rows.length === 0) {
    throw new Error("Chat session belongs to another workspace.");
  }
}

function toChatSummary(row: typeof chats.$inferSelect): ChatSummary {
  return {
    createdAt: row.createdAt,
    sessionId: row.sessionId,
    title: row.title,
    updatedAt: row.updatedAt,
    usage: {
      costUsd: row.costUsd,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    },
  };
}

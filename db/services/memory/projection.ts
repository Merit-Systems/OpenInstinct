import { and, desc, eq, isNotNull } from "drizzle-orm";
import { memoryGenerations, memoryRecords, memoryState } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import type { MemoryTransaction } from "./scope";

export function projectRecords(
  rows: (typeof memoryRecords.$inferSelect)[],
  now = new Date()
) {
  const live = rows.filter(
    (row) =>
      row.content?.status === "active" &&
      (!row.content.expiresAt || new Date(row.content.expiresAt) > now)
  );
  const recordIds: string[] = [];
  const render = (records: typeof live) => {
    const lines: string[] = [];
    let length = 0;
    for (const row of records) {
      if (!row.content) continue;
      const line = `- [${row.id}] ${row.content.title}: ${row.content.body}`;
      const bytes = Buffer.byteLength(JSON.stringify(line), "utf8");
      if (length + bytes > 6_000) continue;
      lines.push(line);
      recordIds.push(row.id);
      length += bytes;
    }
    return lines.join("\n");
  };
  return {
    profile: render(live.filter((row) => row.content?.kind !== "episode")),
    currentContext: render(
      live.filter((row) => row.content?.kind === "episode")
    ),
    recordIds,
  };
}

export async function publishMemoryGeneration(
  transaction: MemoryTransaction,
  scope: AccessScope,
  scopeKey: string
) {
  const [state] = await transaction
    .select()
    .from(memoryState)
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
      )
    )
    .limit(1);
  if (!state) throw new Error("Memory state is unavailable.");
  const rows = await transaction
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.workspaceId, scope.workspaceId),
        eq(memoryRecords.scopeKey, scopeKey),
        isNotNull(memoryRecords.content)
      )
    )
    .orderBy(
      desc(memoryRecords.explicit),
      desc(memoryRecords.updatedAt),
      memoryRecords.id
    );
  const [generation] = await transaction
    .insert(memoryGenerations)
    .values({
      workspaceId: scope.workspaceId,
      scopeKey,
      generation: state.generation + 1,
      deletionEpoch: state.deletionEpoch,
      ...projectRecords(rows),
    })
    .returning();
  if (!generation)
    throw new Error("The memory generation could not be published.");
  await transaction
    .update(memoryState)
    .set({ generation: generation.generation })
    .where(
      and(
        eq(memoryState.workspaceId, scope.workspaceId),
        eq(memoryState.scopeKey, scopeKey)
      )
    );
  return generation;
}

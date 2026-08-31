import "server-only";

import { createWorld } from "@workflow/world-vercel";
import { listOwnedSessionIds } from "@/db/services/sessions";
import type { AccessScope } from "@/lib/access-scope";
import { taskHistoryPageSchema } from "@/lib/task-history";

const pageSize = 25;
const workflowName = "workflow//eve//workflowEntry";

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

  while (runs.length < pageSize && hasMore && pagesRead < 10) {
    const page = await world.runs.list({
      pagination: {
        cursor: nextCursor,
        limit: pageSize - runs.length,
        sortOrder: "desc",
      },
      resolveData: "none",
      workflowName,
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

  return taskHistoryPageSchema.parse({
    cursor: nextCursor ?? null,
    hasMore,
    runs: runs.map((run) => ({
      createdAt: run.createdAt.toISOString(),
      prompt: run.attributes["$eve.title"] ?? "Untitled task",
      sessionId: run.runId,
      status: run.status,
      updatedAt: run.updatedAt.toISOString(),
    })),
  });
}

import { createWorld } from "@workflow/world-vercel";
import { taskHistoryPageSchema } from "@/lib/task-history";
import { listOwnedAgentSessionIds } from "@/lib/server/workspace-data";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/lib/server/request-scope";

export const runtime = "nodejs";

const pageSize = 25;
const workflowName = "workflow//eve//workflowEntry";

export async function GET(request: Request) {
  try {
    const scope = await requireRequestScope();
    const ownedSessionIds = await listOwnedAgentSessionIds(scope);
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
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

    const body = taskHistoryPageSchema.parse({
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

    return Response.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    console.error("Unable to read task history", error);
    return Response.json(
      { error: "Unable to read the durable task history." },
      { status: 500 }
    );
  }
}

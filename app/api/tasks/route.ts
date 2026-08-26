import { createWorld } from "@workflow/world-vercel";
import { taskHistoryPageSchema } from "@/lib/task-history";

export const runtime = "nodejs";

const pageSize = 25;
const workflowName = "workflow//eve//workflowEntry";

export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const world = createWorld({
    headers: { "User-Agent": "local-vault-assistant/task-history" },
  });

  try {
    const page = await world.runs.list({
      pagination: { cursor, limit: pageSize, sortOrder: "desc" },
      resolveData: "none",
      workflowName,
    });
    const body = taskHistoryPageSchema.parse({
      cursor: page.cursor,
      hasMore: page.hasMore,
      runs: page.data
        .filter((run) => run.attributes["$eve.type"] === "session")
        .map((run) => ({
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
    console.error("Unable to read task history", error);
    return Response.json(
      { error: "Unable to read the durable task history." },
      { status: 500 }
    );
  }
}

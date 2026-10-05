import { z } from "zod";
import { scheduledRunOrigin } from "@shared/environment/scheduled-origin";

const actionSchema = z.enum(["command", "wake", "report", "respond"]);

// Vercel sends these routes directly to Eve. Next handles local/self-hosted proxying.
export async function POST(
  request: Request,
  context: RouteContext<"/internal/scheduled-run/[action]">
) {
  const action = actionSchema.safeParse((await context.params).action);
  if (!action.success) return new Response(null, { status: 404 });
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  return fetch(
    new URL(
      "/internal/scheduled-run/" + action.data,
      await scheduledRunOrigin()
    ),
    {
      body: await request.text(),
      headers,
      method: "POST",
      redirect: "error",
    }
  );
}

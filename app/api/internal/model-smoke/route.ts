import { timingSafeEqual } from "node:crypto";
import { generateText, tool } from "ai";
import { googleWorkspaceReadInputSchema } from "@/agent/tools/google_workspace_read";
import { googleWorkspaceWriteInputSchema } from "@/agent/tools/google_workspace_write";
import { createHaikuModelSelection } from "@/lib/anthropic";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const selection = createHaikuModelSelection();
  const result = await generateText({
    maxOutputTokens: 20,
    model: selection.model,
    prompt: "Do not call a tool. Reply with exactly MOUSE_MODEL_OK",
    tools: {
      google_workspace_read: tool({
        description:
          "Production schema smoke check for Google Workspace reads.",
        execute: async () => ({ ok: true }),
        inputSchema: googleWorkspaceReadInputSchema,
      }),
      google_workspace_write: tool({
        description:
          "Production schema smoke check for Google Workspace writes.",
        execute: async () => ({ ok: true }),
        inputSchema: googleWorkspaceWriteInputSchema,
      }),
    },
  });

  return Response.json({
    contextWindowTokens: selection.modelContextWindowTokens,
    modelId: selection.model.modelId,
    ok: result.text.trim() === "MOUSE_MODEL_OK",
    text: result.text,
  });
}

function isAuthorized(authorization: string | null) {
  const expected = env.MODEL_SMOKE_SECRET;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;

  const actualBuffer = Buffer.from(authorization.slice("Bearer ".length));
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

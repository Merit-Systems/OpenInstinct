import { chatListSchema, saveChatSchema } from "@/lib/chat";
import {
  isAllowedManagerMutationOrigin,
  isLocalManagerHostname,
} from "@/lib/manager";
import { getAppStore } from "@/lib/server/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = denyRequest(request);
  if (denied) return denied;

  return Response.json(
    chatListSchema.parse(await (await getAppStore()).listChats()),
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const denied = denyRequest(request, true);
  if (denied) return denied;

  try {
    const chat = saveChatSchema.parse(await request.json());
    await (await getAppStore()).saveChat(chat);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to save chat.",
      },
      { status: 400 }
    );
  }
}

function denyRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!isLocalManagerHostname(url.hostname)) {
    return Response.json(
      { error: "Chat history is available only on this device." },
      { status: 403 }
    );
  }

  if (
    mutation &&
    !isAllowedManagerMutationOrigin({
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      requestUrl: request.url,
    })
  ) {
    return Response.json(
      { error: "Cross-origin chat writes are blocked." },
      { status: 403 }
    );
  }
}

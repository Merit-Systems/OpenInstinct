import { chatListSchema, saveChatSchema } from "@/lib/chat";
import {
  isAllowedManagerMutationOrigin,
  isAllowedMutationOrigin,
  isLocalManagerHostname,
} from "@/lib/manager";
import { getEnv } from "@/lib/runtime-env";
import { getAppStore } from "@/lib/server/app-store";
import {
  requireRequestScope,
  UnauthenticatedError,
  unauthorizedResponse,
} from "@/lib/server/request-scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = await requireRequestScope();
    const denied = denyRequest(request, scope.mode);
    if (denied) return denied;
    return Response.json(
      chatListSchema.parse(await (await getAppStore()).listChats(scope)),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    return chatError(
      error instanceof Error ? error.message : "Unable to load chats."
    );
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireRequestScope();
    const denied = denyRequest(request, scope.mode, true);
    if (denied) return denied;
    const chat = saveChatSchema.parse(await request.json());
    await (await getAppStore()).saveChat(scope, chat);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return unauthorizedResponse();
    return chatError(
      error instanceof Error ? error.message : "Unable to save chat."
    );
  }
}

function denyRequest(
  request: Request,
  mode: "hosted" | "local",
  mutation = false
) {
  const url = new URL(request.url);
  const remoteLocalManagerAllowed =
    mode === "local" && getEnv().LOCAL_VAULT_ASSISTANT_ALLOW_REMOTE_MANAGER;
  if (
    mode === "local" &&
    !remoteLocalManagerAllowed &&
    !isLocalManagerHostname(url.hostname)
  ) {
    return Response.json(
      { error: "Chat history is available only on this device." },
      { status: 403 }
    );
  }

  if (mutation) {
    const isAllowed =
      mode === "local" && !remoteLocalManagerAllowed
        ? isAllowedManagerMutationOrigin
        : isAllowedMutationOrigin;
    if (
      !isAllowed({
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
}

function chatError(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

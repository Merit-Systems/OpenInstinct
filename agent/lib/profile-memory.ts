import type { SessionContext } from "eve/context";
import type { MemoryScopeContext } from "eve/memory";
import { z } from "zod";
import type { env } from "@/env";
import { scopeFromPrincipal, type AccessScope } from "@/lib/access-scope";

export function resolveProfileMemoryBackend(
  environment: Pick<
    typeof env,
    "BLOB_READ_WRITE_TOKEN" | "BLOB_STORE_ID" | "NODE_ENV" | "VERCEL_ENV"
  >
) {
  if (environment.NODE_ENV !== "production") {
    return { kind: "automatic" as const };
  }

  if (environment.BLOB_STORE_ID) {
    return {
      kind: "vercel-blob" as const,
      options: { storeId: environment.BLOB_STORE_ID },
    };
  }

  return environment.VERCEL_ENV === undefined &&
    environment.BLOB_READ_WRITE_TOKEN
    ? {
        kind: "vercel-blob" as const,
        options: { token: environment.BLOB_READ_WRITE_TOKEN },
      }
    : { kind: "automatic" as const };
}

export function resolveProfileMemoryScope(context: MemoryScopeContext) {
  const caller = context.session.auth.current;
  const workspaceId = z.string().safeParse(caller?.attributes.workspaceId);

  return caller?.principalType === "user" && workspaceId.success
    ? workspaceId.data
    : null;
}

export function resolvePersonalInfoMemoryScope(context: MemoryScopeContext) {
  return resolvePersonalInfoAccessScope(context)?.workspaceId ?? null;
}

export function resolvePersonalInfoAccessScope(
  context: Pick<MemoryScopeContext | SessionContext, "session">
): AccessScope | null {
  const caller = [
    context.session.auth.current,
    context.session.auth.initiator,
  ].find((principal) => {
    if (principal?.principalType !== "user") return false;
    return z.string().safeParse(principal.attributes.workspaceId).success;
  });

  return caller ? scopeFromPrincipal(caller) : null;
}

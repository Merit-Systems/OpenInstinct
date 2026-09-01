import type { MemoryScopeContext } from "eve/memory";
import { z } from "zod";
import type { env } from "@/env";

export function resolveProfileMemoryBackend(
  environment: Pick<
    typeof env,
    "BLOB_READ_WRITE_TOKEN" | "NODE_ENV" | "VERCEL_ENV"
  >
) {
  return environment.NODE_ENV === "production" &&
    environment.VERCEL_ENV === undefined &&
    environment.BLOB_READ_WRITE_TOKEN
    ? {
        kind: "vercel-blob" as const,
        token: environment.BLOB_READ_WRITE_TOKEN,
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

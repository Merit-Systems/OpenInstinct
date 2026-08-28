import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { vercelBlob } from "eve/memory/file/vercel";
import { env } from "@/lib/env";

const provider =
  env.NODE_ENV === "production" &&
  env.VERCEL_ENV === undefined &&
  env.BLOB_READ_WRITE_TOKEN
    ? fileMemory({
        backend: vercelBlob({ token: env.BLOB_READ_WRITE_TOKEN }),
      })
    : fileMemory();

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider,
  scope(ctx) {
    const caller = ctx.session.auth.current;
    const workspaceId = caller?.attributes.workspaceId;

    return caller?.principalType === "user" && typeof workspaceId === "string"
      ? workspaceId
      : null;
  },
});

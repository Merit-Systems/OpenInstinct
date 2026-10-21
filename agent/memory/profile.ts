import { defineMemory } from "eve/memory";
import { fileMemory, inMemory } from "eve/memory/file";
import { vercelBlob } from "eve/memory/file/vercel";
import {
  preserveProfileMemoryCancellation,
  resolveProfileMemoryBackend,
  resolveProfileMemoryScope,
} from "../lib/profile-memory";
import { env } from "@shared/environment";
import { withProfileMemoryMigration } from "../lib/memory/legacy";

const configuration = resolveProfileMemoryBackend(env);
const backend =
  configuration.kind === "vercel-blob"
    ? vercelBlob(configuration.options)
    : env.NODE_ENV !== "production"
      ? inMemory()
      : vercelBlob({
          storeId: env.EVE_MEMORY_BLOB_STORE_ID ?? env.BLOB_STORE_ID,
          token:
            env.EVE_MEMORY_BLOB_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN,
        });
const provider = preserveProfileMemoryCancellation(
  withProfileMemoryMigration(fileMemory({ backend }), backend)
);

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider,
  scope: resolveProfileMemoryScope,
});

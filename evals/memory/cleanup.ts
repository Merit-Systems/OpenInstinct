/* oxlint-disable eslint/no-await-in-loop -- Delete each owned artifact only after its purge claim, then observe the remaining ledger. */
import { setTimeout } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { db, memoryArtifacts } from "@db";
import {
  claimMemoryBlobPurge,
  completeMemoryBlobPurge,
  listPendingMemoryBlobPurges,
} from "@db/services/memory/artifacts";
import { env } from "@shared/environment";
import { accessScopeForUser } from "@shared/identity/access-scope";

export async function cleanupMemoryEvalArtifacts() {
  const scope = accessScopeForUser("better-auth:browser-benchmark");
  const owned = and(
    eq(memoryArtifacts.workspaceId, scope.workspaceId),
    eq(memoryArtifacts.userId, scope.userId)
  );
  await db.update(memoryArtifacts).set({ status: "purge" }).where(owned);
  const deadline = Date.now() + 6 * 60_000;
  for (;;) {
    const [remaining] = await db
      .select({ pathname: memoryArtifacts.pathname })
      .from(memoryArtifacts)
      .where(owned)
      .limit(1);
    if (!remaining) return;
    if (Date.now() >= deadline)
      throw new Error(
        "Memory evaluation artifacts are still awaiting safe deletion."
      );
    const artifacts = (
      await listPendingMemoryBlobPurges(100, [scope.workspaceId])
    ).filter((artifact) => artifact.userId === scope.userId);
    for (const artifact of artifacts) {
      if (
        !(await claimMemoryBlobPurge(
          scope,
          artifact.scopeKey,
          artifact.pathname
        ))
      )
        continue;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        throw new Error(
          "Memory evaluation artifact cleanup exceeded its deadline."
        );
      await del(artifact.pathname, {
        storeId: env.BLOB_STORE_ID,
        token: env.BLOB_READ_WRITE_TOKEN,
        abortSignal: AbortSignal.timeout(Math.min(10_000, remainingMs)),
      });
      await completeMemoryBlobPurge(
        scope,
        artifact.scopeKey,
        artifact.pathname
      );
    }
    if (artifacts.length === 0) await setTimeout(1_000);
  }
}

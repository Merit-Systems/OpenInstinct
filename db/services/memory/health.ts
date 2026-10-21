import { and, count, desc, eq, min } from "drizzle-orm";
import {
  db,
  memoryArtifacts,
  memoryGenerations,
  memoryJobs,
  memorySources,
} from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { requireMemoryMembership } from "./scope";

export async function readMemoryHealth(scope: AccessScope, scopeKey: string) {
  await requireMemoryMembership(scope);
  const [sources, jobs, artifacts, generations] = await Promise.all([
    db
      .select({
        status: memorySources.status,
        count: count(),
        oldestCreatedAt: min(memorySources.createdAt),
      })
      .from(memorySources)
      .where(
        and(
          eq(memorySources.workspaceId, scope.workspaceId),
          eq(memorySources.scopeKey, scopeKey)
        )
      )
      .groupBy(memorySources.status)
      .orderBy(memorySources.status),
    db
      .select({
        status: memoryJobs.status,
        count: count(),
        oldestCreatedAt: min(memoryJobs.createdAt),
        nextAvailableAt: min(memoryJobs.availableAt),
      })
      .from(memoryJobs)
      .where(
        and(
          eq(memoryJobs.workspaceId, scope.workspaceId),
          eq(memoryJobs.scopeKey, scopeKey)
        )
      )
      .groupBy(memoryJobs.status)
      .orderBy(memoryJobs.status),
    db
      .select({
        status: memoryArtifacts.status,
        count: count(),
        oldestCreatedAt: min(memoryArtifacts.createdAt),
      })
      .from(memoryArtifacts)
      .where(
        and(
          eq(memoryArtifacts.workspaceId, scope.workspaceId),
          eq(memoryArtifacts.scopeKey, scopeKey)
        )
      )
      .groupBy(memoryArtifacts.status)
      .orderBy(memoryArtifacts.status),
    db
      .select({ createdAt: memoryGenerations.createdAt })
      .from(memoryGenerations)
      .where(
        and(
          eq(memoryGenerations.workspaceId, scope.workspaceId),
          eq(memoryGenerations.scopeKey, scopeKey)
        )
      )
      .orderBy(desc(memoryGenerations.generation))
      .limit(1),
  ]);
  return {
    sources,
    jobs,
    artifacts,
    lastPublishedAt: generations[0]?.createdAt ?? null,
  };
}

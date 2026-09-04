import { eq, sql } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { db, proactionSettings } from "@/db";

const defaultProactionSettings = {
  briefLocalTime: "08:00",
  linqThreadId: null,
  timezone: "UTC",
} as const;

export async function readProactionSettings(scope: AccessScope) {
  const rows = await db
    .select({
      briefLocalTime: proactionSettings.briefLocalTime,
      linqThreadId: proactionSettings.linqThreadId,
      timezone: proactionSettings.timezone,
    })
    .from(proactionSettings)
    .where(eq(proactionSettings.workspaceId, scope.workspaceId))
    .limit(1);
  return rows[0] ?? { ...defaultProactionSettings };
}

export async function saveProactionSettings(
  scope: AccessScope,
  patch: { readonly briefLocalTime?: string; readonly timezone?: string },
  now = new Date()
) {
  await db
    .insert(proactionSettings)
    .values({
      briefLocalTime:
        patch.briefLocalTime ?? defaultProactionSettings.briefLocalTime,
      timezone: patch.timezone ?? defaultProactionSettings.timezone,
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: proactionSettings.workspaceId,
      set: {
        briefLocalTime:
          patch.briefLocalTime ?? sql`${proactionSettings.briefLocalTime}`,
        timezone: patch.timezone ?? sql`${proactionSettings.timezone}`,
        updatedAt: now,
      },
    });
  return readProactionSettings(scope);
}

// Remembers the user's most recent Linq thread as the home delivery target.
// Returns true when the stored thread changed.
export async function rememberLinqThread(
  scope: AccessScope,
  linqThreadId: string,
  now = new Date()
) {
  const [row] = await db
    .insert(proactionSettings)
    .values({ linqThreadId, updatedAt: now, workspaceId: scope.workspaceId })
    .onConflictDoUpdate({
      target: proactionSettings.workspaceId,
      set: { linqThreadId, updatedAt: now },
      setWhere: sql`${proactionSettings.linqThreadId} IS DISTINCT FROM ${linqThreadId}`,
    })
    .returning({ linqThreadId: proactionSettings.linqThreadId });
  return row !== undefined;
}

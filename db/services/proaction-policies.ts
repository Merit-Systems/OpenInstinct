import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { proactionPolicyPatchSchema } from "@/agent/lib/proactions/define";
import type { AccessScope } from "@/lib/access-scope";
import { db, proactionPolicies } from "@/db";

export async function readProactionPolicies(scope: AccessScope) {
  const rows = await db
    .select({
      autonomy: proactionPolicies.autonomy,
      enabled: proactionPolicies.enabled,
      proactionId: proactionPolicies.proactionId,
    })
    .from(proactionPolicies)
    .where(eq(proactionPolicies.workspaceId, scope.workspaceId));
  return new Map(
    rows.map(({ proactionId, ...policy }) => [proactionId, policy])
  );
}

export async function saveProactionPolicy(
  scope: AccessScope,
  proactionId: string,
  patch: z.infer<typeof proactionPolicyPatchSchema>,
  now = new Date()
) {
  const [row] = await db
    .insert(proactionPolicies)
    .values({
      autonomy: patch.autonomy ?? null,
      enabled: patch.enabled ?? null,
      proactionId,
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [proactionPolicies.workspaceId, proactionPolicies.proactionId],
      set: {
        autonomy: patch.autonomy ?? sql`${proactionPolicies.autonomy}`,
        enabled: patch.enabled ?? sql`${proactionPolicies.enabled}`,
        updatedAt: now,
      },
    })
    .returning({
      autonomy: proactionPolicies.autonomy,
      enabled: proactionPolicies.enabled,
    });
  if (!row) throw new Error("The proaction policy could not be saved.");
  return row;
}

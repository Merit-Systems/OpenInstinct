import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { db, settings } from "@/db";

const gatewayModelKey = "gateway_model";

export async function readGatewayModel(scope: AccessScope) {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.workspaceId, scope.workspaceId),
        eq(settings.key, gatewayModelKey)
      )
    )
    .limit(1);
  return rows[0]?.value;
}

export async function selectGatewayModel(scope: AccessScope, modelId: string) {
  await db
    .insert(settings)
    .values({
      key: gatewayModelKey,
      value: modelId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value: modelId },
    });
}

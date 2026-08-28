import { and, eq } from "drizzle-orm";
import type { AccessScope } from "../access-scope";
import { settings } from "../db/schema";
import { database } from "./database";

const GATEWAY_MODEL_KEY = "gateway_model";

export async function readGatewayModel(scope: AccessScope) {
  const row = await database().query.settings.findFirst({
    columns: { value: true },
    where: and(
      eq(settings.workspaceId, scope.workspaceId),
      eq(settings.key, GATEWAY_MODEL_KEY)
    ),
  });
  return row?.value;
}

export async function selectGatewayModel(scope: AccessScope, modelId: string) {
  await database()
    .insert(settings)
    .values({
      key: GATEWAY_MODEL_KEY,
      value: modelId,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      set: { value: modelId },
      target: [settings.workspaceId, settings.key],
    });
}

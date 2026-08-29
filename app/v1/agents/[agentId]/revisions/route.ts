import { createRevision, getAgent, listRevisions } from "@/db/services/agents";
import { agentManifestSchema } from "@/lib/agent-manifest";
import {
  apiError,
  apiErrorFor,
  apiJson,
  authorizeApiRequest,
  finalizeIdempotencyKey,
  parseJson,
  requiredIdempotencyKey,
  releaseIdempotencyReservation,
  reserveIdempotencyKey,
} from "@/lib/api/v1-auth";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: RouteContext<"/v1/agents/[agentId]/revisions">
) {
  const auth = await authorizeApiRequest(request, "agents:write");
  if (auth.response) return auth.response;
  const { agentId } = await context.params;
  if (!(await getAgent(auth.context.scope, agentId)))
    return apiError(
      404,
      "not_found",
      "Resource not found.",
      auth.context.requestId
    );
  const idempotency = requiredIdempotencyKey(request, auth.context.requestId);
  if (idempotency.response) return idempotency.response;
  const body = await parseJson(request, agentManifestSchema);
  if (body.error)
    return apiError(400, "invalid_request", body.error, auth.context.requestId);
  const route = `/v1/agents/${agentId}/revisions`;
  const reservation = await reserveIdempotencyKey(
    auth.context.scope.workspaceId,
    route,
    idempotency.key
  );
  if (reservation.state === "complete") {
    if (!reservation.row.resourceId)
      return apiError(
        409,
        "idempotency_conflict",
        "A request with this Idempotency-Key is in progress.",
        auth.context.requestId
      );
    const revision = (await listRevisions(auth.context.scope, agentId)).find(
      (row) => row.id === reservation.row.resourceId
    );
    if (revision)
      return apiJson(
        { data: revision },
        reservation.row.responseStatus,
        auth.context.requestId
      );
  } else if (reservation.state === "in_flight")
    return apiError(
      409,
      "idempotency_conflict",
      "A request with this Idempotency-Key is in progress.",
      auth.context.requestId
    );
  let revision: Awaited<ReturnType<typeof createRevision>>;
  try {
    revision = await createRevision(auth.context.scope, agentId, body.data);
  } catch (error) {
    await releaseIdempotencyReservation(
      auth.context.scope.workspaceId,
      route,
      idempotency.key
    );
    return apiErrorFor(error, auth.context.requestId);
  }
  try {
    await finalizeIdempotencyKey(
      auth.context.scope.workspaceId,
      route,
      idempotency.key,
      revision.id,
      201
    );
    return apiJson({ data: revision }, 201, auth.context.requestId);
  } catch (error) {
    return apiErrorFor(error, auth.context.requestId);
  }
}

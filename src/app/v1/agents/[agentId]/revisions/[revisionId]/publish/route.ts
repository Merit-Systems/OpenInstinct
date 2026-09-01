import { getAgent, publishRevision } from "@/db/services/agents";
import {
  apiError,
  apiErrorFor,
  apiJson,
  authorizeApiRequest,
} from "@/lib/api/v1-auth";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: RouteContext<"/v1/agents/[agentId]/revisions/[revisionId]/publish">
) {
  const auth = await authorizeApiRequest(request, "agents:write");
  if (auth.response) return auth.response;
  const { agentId, revisionId } = await context.params;
  const agent = await getAgent(auth.context.scope, agentId);
  if (!agent)
    return apiError(
      404,
      "not_found",
      "Resource not found.",
      auth.context.requestId
    );
  if (agent.status === "archived")
    return apiError(
      409,
      "conflict",
      "Agent is archived.",
      auth.context.requestId
    );
  try {
    return apiJson(
      { data: await publishRevision(auth.context.scope, agentId, revisionId) },
      200,
      auth.context.requestId
    );
  } catch (error) {
    return apiErrorFor(error, auth.context.requestId);
  }
}

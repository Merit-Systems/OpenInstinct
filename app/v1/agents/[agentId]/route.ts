import { getAgent } from "@/db/services/agents";
import { apiError, apiJson, authorizeApiRequest } from "@/lib/api/v1-auth";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: RouteContext<"/v1/agents/[agentId]">
) {
  const auth = await authorizeApiRequest(request, "agents:read");
  if (auth.response) return auth.response;
  const { agentId } = await context.params;
  const agent = await getAgent(auth.context.scope, agentId);
  return agent
    ? apiJson({ data: agent }, 200, auth.context.requestId)
    : apiError(404, "not_found", "Resource not found.", auth.context.requestId);
}

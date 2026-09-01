import { usageEventKinds } from "@/db";
import { sumUsageSince } from "@/db/services/usage";
import { apiJson, authorizeApiRequest } from "@/lib/api/v1-auth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "usage:read");
  if (auth.response) return auth.response;
  const now = new Date();
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
  const totals = await Promise.all(
    usageEventKinds.map(
      async (kind) =>
        [kind, await sumUsageSince(auth.context.scope, kind, since)] as const
    )
  );
  return apiJson(
    { data: { since, totals: Object.fromEntries(totals) } },
    200,
    auth.context.requestId
  );
}

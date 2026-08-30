import { drainWebhookDeliveries } from "@/db/services/webhooks";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (
    env.CRON_SECRET === undefined ||
    request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const summary = await drainWebhookDeliveries({ limit: 25 });
    return Response.json(summary);
  } catch {
    return Response.json(
      { error: "Unable to drain webhook deliveries." },
      { status: 500 }
    );
  }
}

import { drainWebhookDeliveries } from "@/db/services/webhooks";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

export function createDrainWebhooksRoute({
  cronSecret,
  drain,
}: {
  readonly cronSecret: string | undefined;
  readonly drain: typeof drainWebhookDeliveries;
}) {
  return async function GET(request: Request) {
    if (
      cronSecret === undefined ||
      request.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return new Response(null, { status: 404 });
    }

    try {
      const summary = await drain({ limit: 25 });
      return Response.json(summary);
    } catch {
      return Response.json(
        { error: "Unable to drain webhook deliveries." },
        { status: 500 }
      );
    }
  };
}

export const GET = createDrainWebhooksRoute({
  cronSecret: env.CRON_SECRET,
  drain: drainWebhookDeliveries,
});

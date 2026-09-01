import { afterEach, describe, expect, it, vi } from "vitest";
import type { drainWebhookDeliveries as DrainWebhookDeliveries } from "@/db/services/webhooks";
import { createDrainWebhooksRoute } from "@/app/api/cron/drain-webhooks/route";

const drainWebhookDeliveries = vi.fn<typeof DrainWebhookDeliveries>();

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/cron/drain-webhooks", () => {
  it("returns 404 when CRON_SECRET is not configured", async () => {
    const route = await loadRoute();

    await expect(
      route.GET(new Request("http://test/api/cron/drain-webhooks"))
    ).resolves.toMatchObject({ status: 404 });
  });

  it("returns 404 for Bearer undefined when CRON_SECRET is not configured", async () => {
    const route = await loadRoute();

    await expect(
      route.GET(
        new Request("http://test/api/cron/drain-webhooks", {
          headers: { authorization: "Bearer undefined" },
        })
      )
    ).resolves.toMatchObject({ status: 404 });
  });

  it("returns 404 for missing or incorrect bearer credentials", async () => {
    const route = await loadRoute("cron-secret");

    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const headers = authorization ? { authorization } : undefined;
      await expect(
        route.GET(
          new Request("http://test/api/cron/drain-webhooks", { headers })
        )
      ).resolves.toMatchObject({ status: 404 });
    }
    expect(drainWebhookDeliveries).not.toHaveBeenCalled();
  });

  it("drains up to 25 deliveries and returns the summary", async () => {
    drainWebhookDeliveries.mockResolvedValue({
      dead: 0,
      delivered: 0,
      failed: 0,
    });
    const route = await loadRoute("cron-secret");

    const response = await route.GET(
      new Request("http://test/api/cron/drain-webhooks", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dead: 0,
      delivered: 0,
      failed: 0,
    });
    expect(route.maxDuration).toBe(300);
    expect(drainWebhookDeliveries).toHaveBeenCalledWith({ limit: 25 });
  });

  it("returns a generic error when draining fails", async () => {
    drainWebhookDeliveries.mockRejectedValue(new Error("database unavailable"));
    const route = await loadRoute("cron-secret");

    const response = await route.GET(
      new Request("http://test/api/cron/drain-webhooks", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to drain webhook deliveries.",
    });
  });
});

async function loadRoute(secret?: string) {
  return {
    GET: createDrainWebhooksRoute({
      cronSecret: secret,
      drain: drainWebhookDeliveries,
    }),
    maxDuration: 300,
  };
}

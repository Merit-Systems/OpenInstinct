import type { RouteHandlerArgs } from "eve/channels";
import { describe, expect, it } from "vitest";
import scheduledRunChannel from "@/agent/channels/scheduled-run";

describe("scheduled run channel authentication", () => {
  it("rejects an unauthenticated report request", async () => {
    const route = scheduledRunChannel.routes.find(
      (candidate) =>
        candidate.transport !== "websocket" &&
        candidate.method === "POST" &&
        candidate.path === "/internal/scheduled-run/report"
    );
    if (!route || route.transport === "websocket") {
      throw new Error("The scheduled report route is unavailable.");
    }

    const response = await route.handler(
      new Request("https://assistant.example/internal/scheduled-run/report", {
        body: "not valid JSON",
        method: "POST",
      }),
      unexpectedRouteContext()
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });
});

function unexpectedRouteContext() {
  return {
    attachSession: unexpectedRouteRequest,
    from: unexpectedRouteRequest,
    params: {},
    requestIp: null,
    resolveSession: unexpectedRouteRequest,
    to: unexpectedRouteRequest,
    waitUntil: unexpectedRouteRequest,
  } satisfies RouteHandlerArgs;
}

function unexpectedRouteRequest(): never {
  throw new Error("The request should stop at authentication.");
}

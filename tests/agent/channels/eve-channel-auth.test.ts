import type { RouteHandlerArgs } from "eve/channels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as AuthSession from "@/auth/session";
import * as SessionService from "@/db/services/sessions";
import * as ScopeService from "@/db/services/scope";
import * as Environment from "@/env";
import eveChannel from "@/agent/channels/eve";
import { authSessionFor } from "@/tests/helpers/auth-session";

const getAuthSessionMock = vi.spyOn(AuthSession, "getAuthSession");
const isSessionOwnedMock = vi.spyOn(SessionService, "isSessionOwned");
const isWorkspaceScopeEnforcementEnabledMock = vi.spyOn(
  Environment,
  "isWorkspaceScopeEnforcementEnabled"
);
const verifyScopeAccessMock = vi.spyOn(ScopeService, "verifyScopeAccess");

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  getAuthSessionMock.mockResolvedValue(
    authSessionFor({
      id: "user-1",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    })
  );
  isSessionOwnedMock.mockResolvedValue(false);
  isWorkspaceScopeEnforcementEnabledMock.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Eve channel authentication", () => {
  it("rejects a denied scope with the same response as a missing session", async () => {
    const route = sessionStreamRoute();
    isWorkspaceScopeEnforcementEnabledMock.mockReturnValue(true);
    verifyScopeAccessMock.mockResolvedValue(undefined);

    const denied = await route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session-one/stream"
      ),
      unexpectedRouteContext()
    );
    getAuthSessionMock.mockResolvedValue(null);
    const unauthenticated = await route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session-one/stream"
      ),
      unexpectedRouteContext()
    );

    expect(denied.status).toBe(401);
    expect(await denied.text()).toBe(await unauthenticated.text());
  });

  it("keeps scope verification disabled by default", async () => {
    const route = sessionStreamRoute();

    const responsePromise = route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session-one/stream"
      ),
      unexpectedRouteContext()
    );
    await vi.runAllTimersAsync();
    await responsePromise;

    expect(verifyScopeAccessMock).not.toHaveBeenCalled();
  });

  it("checks decoded session route ids against workspace ownership", async () => {
    const route = sessionStreamRoute();

    const responsePromise = route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session%2Fone/stream"
      ),
      unexpectedRouteContext()
    );
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(403);
    expect(isSessionOwnedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "better-auth:user-1" }),
      "session/one"
    );
  });
});

function sessionStreamRoute() {
  const route = eveChannel.routes.find(
    (candidate) =>
      candidate.transport !== "websocket" &&
      candidate.method === "GET" &&
      candidate.path === "/eve/v1/session/:sessionId/stream"
  );
  if (!route || route.transport === "websocket") {
    throw new Error("The Eve session stream route is unavailable.");
  }
  return route;
}

function unexpectedRouteContext() {
  return {
    attachSession: unexpectedRouteRequest,
    from: unexpectedRouteRequest,
    params: { sessionId: "session/one" },
    requestIp: null,
    resolveSession: unexpectedRouteRequest,
    to: unexpectedRouteRequest,
    waitUntil: unexpectedRouteRequest,
  } satisfies RouteHandlerArgs;
}

function unexpectedRouteRequest(): never {
  throw new Error("The request should stop at authorization.");
}

import type { RouteHandlerArgs } from "eve/channels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import eveChannel, { eveChannelDependencies } from "../../agent/channels/eve";

const getAuthSession = vi.fn<typeof eveChannelDependencies.getAuthSession>();
const isSessionOwned = vi.fn<typeof eveChannelDependencies.isSessionOwned>();
const isWorkspaceScopeEnforcementEnabled =
  vi.fn<typeof eveChannelDependencies.isWorkspaceScopeEnforcementEnabled>();
const verifyScopeAccess =
  vi.fn<typeof eveChannelDependencies.verifyScopeAccess>();
const originalDependencies = { ...eveChannelDependencies };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  getAuthSession.mockResolvedValue({
    user: {
      id: "user-1",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    },
  });
  isSessionOwned.mockResolvedValue(false);
  isWorkspaceScopeEnforcementEnabled.mockReturnValue(false);
  Object.assign(eveChannelDependencies, {
    getAuthSession,
    isSessionOwned,
    isWorkspaceScopeEnforcementEnabled,
    verifyScopeAccess,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(eveChannelDependencies, originalDependencies);
});

describe("Eve channel authentication", () => {
  it("rejects a denied scope with the same response as a missing session", async () => {
    const route = sessionStreamRoute();
    isWorkspaceScopeEnforcementEnabled.mockReturnValue(true);
    verifyScopeAccess.mockResolvedValue(undefined);

    const denied = await route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session-one/stream"
      ),
      unexpectedRouteContext()
    );
    getAuthSession.mockResolvedValue(null);
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

    expect(verifyScopeAccess).not.toHaveBeenCalled();
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
    expect(isSessionOwned).toHaveBeenCalledWith(
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
  const unexpected = () => {
    throw new Error("The request should stop at authorization.");
  };

  return {
    attachSession: unexpected,
    from: unexpected,
    params: { sessionId: "session/one" },
    requestIp: null,
    resolveSession: unexpected,
    to: unexpected,
    waitUntil: unexpected,
  } satisfies RouteHandlerArgs;
}

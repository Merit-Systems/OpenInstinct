import type { RouteHandlerArgs } from "eve/channels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthSession:
    vi.fn<
      (
        _headers: Headers
      ) => Promise<{ user: { id: string; phoneNumber: string } } | null>
    >(),
  isSessionOwned:
    vi.fn<(_scope: unknown, _sessionId: string) => Promise<boolean>>(),
}));

vi.mock("@/auth/session", () => ({
  getAuthSession: mocks.getAuthSession,
}));

vi.mock("@/db/services/sessions", () => ({
  isSessionOwned: mocks.isSessionOwned,
}));

import eveChannel from "../agent/channels/eve";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.getAuthSession.mockResolvedValue({
    user: { id: "user-1", phoneNumber: "+12025550123" },
  });
  mocks.isSessionOwned.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Eve channel authentication", () => {
  it("checks decoded session route ids against workspace ownership", async () => {
    const route = eveChannel.routes.find(
      (candidate) =>
        candidate.transport !== "websocket" &&
        candidate.method === "GET" &&
        candidate.path === "/eve/v1/session/:sessionId/stream"
    );
    if (!route || route.transport === "websocket") {
      throw new Error("The Eve session stream route is unavailable.");
    }

    const responsePromise = route.handler(
      new Request(
        "https://assistant.example/eve/v1/session/session%2Fone/stream"
      ),
      unexpectedRouteContext()
    );
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(403);
    expect(mocks.isSessionOwned).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "better-auth:user-1" }),
      "session/one"
    );
  });
});

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

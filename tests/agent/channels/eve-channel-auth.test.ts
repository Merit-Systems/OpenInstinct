import type { RouteHandlerArgs } from "eve/channels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as AuthSession from "@/auth/session";
import * as SessionService from "@/db/services/sessions";
import { authSessionFor } from "@/tests/helpers/auth-session";
import eveChannel, { waitForSessionOwnership } from "@/agent/channels/eve";

const getAuthSessionMock = vi.spyOn(AuthSession, "getAuthSession");
const isSessionOwnedMock = vi.spyOn(SessionService, "isSessionOwned");

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Eve channel authentication", () => {
  it("allows a session ownership hook to settle after workflow startup", async () => {
    isSessionOwnedMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    const ownership = waitForSessionOwnership(
      {
        userId: "better-auth:user-1",
        workspaceId: "personal:workspace-1",
      },
      "session-1"
    );
    await vi.runAllTimersAsync();

    await expect(ownership).resolves.toBe(true);
    expect(isSessionOwnedMock).toHaveBeenCalledTimes(4);
  });

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
    expect(isSessionOwnedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "better-auth:user-1" }),
      "session/one"
    );
  });
});

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

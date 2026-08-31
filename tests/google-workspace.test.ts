import { NoValidTokenError, type ConnectTokenResponse } from "@vercel/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCalendarAvailability } from "@/agent/lib/google-workspace/calendar";
import { googleWorkspaceAuthOptions } from "@/agent/lib/google-workspace/client";
import { gmailUpdateLabels } from "@/agent/lib/google-workspace/gmail";
import { googleWorkspaceWriteApproval } from "@/agent/tools/google_workspace_write";
import {
  GOOGLE_WORKSPACE_SCOPES,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@/lib/google-workspace/config";
import {
  getGoogleWorkspaceConnection,
  googleWorkspaceServerDependencies,
  startGoogleWorkspaceAuthorization,
} from "@/lib/google-workspace/server";

const getTokenResponseMock = vi.spyOn(
  googleWorkspaceServerDependencies,
  "getTokenResponse"
);
const startAuthorizationMock = vi.spyOn(
  googleWorkspaceServerDependencies,
  "startAuthorization"
);

afterEach(() => vi.clearAllMocks());

const scope = {
  userId: "better-auth:user-123",
  workspaceId: "personal:workspace-123",
};

describe("Google Workspace connection", () => {
  it("uses one explicit least-privilege scope set", () => {
    expect(GOOGLE_WORKSPACE_SCOPES).not.toContain("*");
    expect(GOOGLE_WORKSPACE_SCOPES).not.toContain("https://mail.google.com/");
    expect(googleWorkspaceTokenParams(scope.userId)).toEqual({
      scopes: [...GOOGLE_WORKSPACE_SCOPES],
      subject: googleWorkspaceSubject(scope.userId),
    });
    expect(googleWorkspaceAuthOptions.tokenParams).toEqual({
      scopes: [...GOOGLE_WORKSPACE_SCOPES],
    });
    expect(googleWorkspaceAuthOptions.validate).toBe(true);
  });

  it("uses the same user subject for manager and Eve flows", () => {
    expect(googleWorkspaceSubject(scope.userId)).toEqual({
      id: scope.userId,
      issuer: "openinstinct",
      type: "user",
    });
  });

  it("reports connected accounts without exposing tokens", async () => {
    const response: ConnectTokenResponse = {
      claims: { email: "person@example.com" },
      connector: { id: "connector-id", type: "oauth", uid: "google/test" },
      expiresAt: Date.now() + 60_000,
      token: "must-not-leak",
    };
    getTokenResponseMock.mockResolvedValue(response);

    await expect(getGoogleWorkspaceConnection(scope)).resolves.toEqual({
      accountLabel: "person@example.com",
      state: "connected",
    });
    expect(getTokenResponseMock).toHaveBeenCalledWith(
      expect.any(String),
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
  });

  it("reports a missing user grant as disconnected", async () => {
    getTokenResponseMock.mockRejectedValue(
      new NoValidTokenError("No Google grant for this user.")
    );
    await expect(getGoogleWorkspaceConnection(scope)).resolves.toEqual({
      accountLabel: null,
      state: "disconnected",
    });
  });

  it("starts authorization with the canonical subject and scopes", async () => {
    startAuthorizationMock.mockResolvedValue({
      request: "request",
      url: "https://connect.vercel.com/request",
      verifier: "verifier",
    });

    await expect(
      startGoogleWorkspaceAuthorization(
        scope,
        "https://openinstinct.example/?google=connected"
      )
    ).resolves.toBe("https://connect.vercel.com/request");
    expect(startAuthorizationMock).toHaveBeenCalledWith(
      expect.any(String),
      googleWorkspaceTokenParams(scope.userId),
      expect.objectContaining({
        callbackUrl: "https://openinstinct.example/?google=connected",
      })
    );
  });

  it("maps reversible Gmail actions to system labels", () => {
    expect(gmailUpdateLabels("archive")).toEqual({
      addLabelIds: [],
      removeLabelIds: ["INBOX"],
    });
    expect(gmailUpdateLabels("mark_unread")).toEqual({
      addLabelIds: ["UNREAD"],
      removeLabelIds: [],
    });
  });

  it("requires approval for consequential writes only", () => {
    expect(googleWorkspaceWriteApproval("update_email")).toBe("not-applicable");
    expect(googleWorkspaceWriteApproval("send_email")).toBe("user-approval");
    expect(googleWorkspaceWriteApproval("create_calendar_event")).toBe(
      "user-approval"
    );
  });

  it("does not interpret Google FreeBusy errors as availability", () => {
    expect(() =>
      parseCalendarAvailability({
        calendars: {
          "missing@example.com": {
            errors: [{ domain: "global", reason: "notFound" }],
          },
        },
      })
    ).toThrow(/missing@example\.com: notFound/u);

    expect(
      parseCalendarAvailability({
        calendars: {
          primary: {
            busy: [
              {
                end: "2026-08-27T15:00:00-04:00",
                start: "2026-08-27T14:00:00-04:00",
              },
            ],
          },
        },
      })
    ).toEqual({
      calendars: {
        primary: {
          busy: [
            {
              end: "2026-08-27T15:00:00-04:00",
              start: "2026-08-27T14:00:00-04:00",
            },
          ],
        },
      },
    });
  });
});

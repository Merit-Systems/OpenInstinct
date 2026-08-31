import {
  getTokenResponse,
  NoValidTokenError,
  type ConnectTokenResponse,
} from "@vercel/connect";
import type * as VercelConnect from "@vercel/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCalendarAvailability } from "@/agent/lib/google-workspace/calendar";
import { googleWorkspaceAuthOptions } from "@/agent/lib/google-workspace/client";
import { gmailUpdateLabels } from "@/agent/lib/google-workspace/gmail";
import { googleWorkspaceWriteApproval } from "@/agent/tools/google_workspace_write";
import {
  googleWorkspaceScopes,
  googleWorkspaceSubject,
  googleWorkspaceTokenParams,
} from "@/lib/google-workspace";
import { readManagerSnapshot } from "@/modules/manager/server/store";

vi.mock("@vercel/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof VercelConnect>()),
  getTokenResponse: vi.fn<typeof getTokenResponse>(),
}));
vi.mock("@/db/services/settings", () => ({
  getGatewayModel: vi.fn<() => Promise<string>>().mockResolvedValue("test"),
  selectGatewayModel: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/modules/manager/server/vault", () => ({
  readManagerVaultItems: vi.fn<() => Promise<never[]>>().mockResolvedValue([]),
}));

afterEach(() => vi.clearAllMocks());

const scope = {
  userId: "better-auth:user-123",
  workspaceId: "personal:workspace-123",
};

describe("Google Workspace connection", () => {
  it("uses one explicit least-privilege scope set", () => {
    expect(googleWorkspaceScopes).not.toContain("*");
    expect(googleWorkspaceScopes).not.toContain("https://mail.google.com/");
    expect(googleWorkspaceTokenParams(scope.userId)).toEqual({
      scopes: [...googleWorkspaceScopes],
      subject: googleWorkspaceSubject(scope.userId),
    });
    expect(googleWorkspaceAuthOptions.tokenParams).toEqual({
      scopes: [...googleWorkspaceScopes],
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
    vi.mocked(getTokenResponse).mockResolvedValue(response);

    await expect(readManagerSnapshot(scope)).resolves.toMatchObject({
      googleWorkspace: {
        accountLabel: "person@example.com",
        state: "connected",
      },
    });
    expect(getTokenResponse).toHaveBeenCalledWith(
      expect.any(String),
      googleWorkspaceTokenParams(scope.userId),
      { forceRefresh: true }
    );
  });

  it("reports a missing user grant as disconnected", async () => {
    vi.mocked(getTokenResponse).mockRejectedValue(
      new NoValidTokenError("No Google grant for this user.")
    );
    await expect(readManagerSnapshot(scope)).resolves.toMatchObject({
      googleWorkspace: { accountLabel: null, state: "disconnected" },
    });
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

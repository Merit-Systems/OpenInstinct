import { createHash } from "node:crypto";
import type { ToolContext } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCalendarEvent,
  searchGoogleContacts,
} from "@/agent/lib/google-workspace/calendar";
import { withGoogleAuth } from "@/agent/lib/google-workspace/client";
import { sendGmail } from "@/agent/lib/google-workspace/gmail";

interface RequestOptions {
  signal: AbortSignal;
}

const google = vi.hoisted(() => ({
  calendar: vi.fn<(options: unknown) => unknown>(),
  gmail: vi.fn<(options: unknown) => unknown>(),
  people: vi.fn<(options: unknown) => unknown>(),
  setCredentials: vi.fn<(credentials: { access_token: string }) => void>(),
}));

vi.mock("@googleapis/calendar", () => ({ calendar: google.calendar }));
vi.mock("@googleapis/gmail", () => ({
  auth: {
    OAuth2: class {
      setCredentials = google.setCredentials;
    },
  },
  gmail: google.gmail,
}));
vi.mock("@googleapis/people", () => ({ people: google.people }));

afterEach(() => vi.clearAllMocks());

describe("generated Google Workspace clients", () => {
  it("hands the Connect token to Google and requests reauthorization on 401", async () => {
    const ctx = toolContext();
    const error = new GoogleApiError(401);

    await expect(withGoogleAuth(ctx, () => Promise.reject(error))).rejects.toBe(
      error
    );

    expect(ctx.getToken).toHaveBeenCalledOnce();
    expect(google.setCredentials).toHaveBeenCalledWith({
      access_token: "google-access-token",
    });
    expect(ctx.requireAuth).toHaveBeenCalledOnce();
  });

  it("sends typed Gmail requests with a stable retry-safe message ID", async () => {
    const ctx = toolContext();
    const send = vi
      .fn<
        (
          request: unknown,
          options: RequestOptions
        ) => Promise<{ data: { id: string; threadId: string } }>
      >()
      .mockResolvedValue({
        data: { id: "sent-1", threadId: "thread-1" },
      });
    googleClients({ gmail: { users: { messages: { send } } } });

    await sendGmail(ctx, {
      bcc: [],
      body: "Hello",
      cc: [],
      subject: "Status",
      to: ["person@example.com"],
    });

    const stableId = createHash("sha256")
      .update("session-1:call-1")
      .digest("hex")
      .slice(0, 48);
    const raw = Buffer.from(
      [
        "To: person@example.com",
        "Subject: Status",
        `Message-ID: <openinstinct-${stableId}@local>`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
      ].join("\r\n") + "\r\n\r\nHello",
      "utf8"
    ).toString("base64url");
    expect(send).toHaveBeenCalledWith(
      { requestBody: { raw }, userId: "me" },
      { signal: ctx.abortSignal }
    );
  });

  it("recovers a duplicate Calendar insert using the stable event ID", async () => {
    const ctx = toolContext();
    const insert = vi
      .fn<(request: unknown, options: RequestOptions) => Promise<never>>()
      .mockRejectedValue(new GoogleApiError(409));
    const get = vi
      .fn<
        (
          request: { calendarId: string; eventId: string },
          options: RequestOptions
        ) => Promise<{ data: { id: string; summary: string } }>
      >()
      .mockResolvedValue({
        data: { id: "existing-event", summary: "Planning" },
      });
    googleClients({ calendar: { events: { get, insert } } });

    await expect(
      createCalendarEvent(ctx, {
        attendees: ["person@example.com"],
        calendarId: "primary",
        end: "2026-08-28T11:00:00-04:00",
        start: "2026-08-28T10:00:00-04:00",
        summary: "Planning",
        timezone: "America/New_York",
      })
    ).resolves.toEqual({ id: "existing-event", summary: "Planning" });

    const eventId = createHash("sha256")
      .update("session-1:call-1")
      .digest("hex")
      .slice(0, 32);
    expect(insert.mock.calls[0]?.[1]).toEqual({ signal: ctx.abortSignal });
    expect(get).toHaveBeenCalledWith(
      { calendarId: "primary", eventId },
      { signal: ctx.abortSignal }
    );
  });

  it("warms the People search cache before the typed contact query", async () => {
    const ctx = toolContext();
    const searchContacts = vi
      .fn<
        (
          request: unknown,
          options: RequestOptions
        ) => Promise<{
          data: { results?: { person: { resourceName: string } }[] };
        }>
      >()
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { results: [{ person: { resourceName: "people/1" } }] },
      });
    googleClients({ people: { people: { searchContacts } } });

    await expect(searchGoogleContacts(ctx, "Person", 10)).resolves.toEqual({
      contacts: [{ person: { resourceName: "people/1" } }],
    });

    expect(searchContacts).toHaveBeenNthCalledWith(
      1,
      {
        query: "",
        readMask: "names,emailAddresses,phoneNumbers,organizations",
      },
      { signal: ctx.abortSignal }
    );
    expect(searchContacts).toHaveBeenNthCalledWith(
      2,
      {
        pageSize: 10,
        query: "Person",
        readMask: "names,emailAddresses,phoneNumbers,organizations",
      },
      { signal: ctx.abortSignal }
    );
  });
});

function toolContext() {
  const getToken = vi
    .fn<ToolContext["getToken"]>()
    .mockResolvedValue({ token: "google-access-token" });
  const requireAuth = vi.fn<ToolContext["requireAuth"]>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture supplies exactly the ToolContext fields exercised by these helpers.
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    getToken,
    requireAuth,
    session: { id: "session-1" },
  } as unknown as ToolContext & {
    getToken: typeof getToken;
    requireAuth: typeof requireAuth;
  };
}

function googleClients(clients: {
  calendar?: unknown;
  gmail?: unknown;
  people?: unknown;
}) {
  google.calendar.mockReturnValue(clients.calendar ?? {});
  google.gmail.mockReturnValue(clients.gmail ?? {});
  google.people.mockReturnValue(clients.people ?? {});
}

class GoogleApiError extends Error {
  readonly response: { status: number };

  constructor(status: number) {
    super(`Google API returned ${String(status)}`);
    this.response = { status };
  }
}

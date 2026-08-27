import { createHash } from "node:crypto";
import type { ToolContext } from "eve/tools";
import { z } from "zod";
import { googleWorkspaceFetch } from "./client";

export const calendarEventSchema = z.object({
  attendees: z.array(z.email()).max(50).default([]),
  calendarId: z.string().default("primary"),
  description: z.string().max(8_000).optional(),
  end: z.iso.datetime({ offset: true }),
  location: z.string().max(1_000).optional(),
  start: z.iso.datetime({ offset: true }),
  summary: z.string().min(1).max(1_000),
  timezone: z.string().min(1).default("UTC"),
});

const calendarAvailabilitySchema = z.object({
  calendars: z
    .record(
      z.string(),
      z.object({
        busy: z
          .array(z.object({ end: z.string(), start: z.string() }))
          .optional(),
        errors: z
          .array(
            z.object({
              domain: z.string().optional(),
              reason: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

export async function listCalendarEvents(
  ctx: ToolContext,
  input: {
    calendarId: string;
    maxResults: number;
    timeMax: string;
    timeMin: string;
  }
) {
  const params = new URLSearchParams({
    fields:
      "items(id,status,summary,description,location,start,end,attendees(email,responseStatus),htmlLink)",
    maxResults: String(input.maxResults),
    orderBy: "startTime",
    singleEvents: "true",
    timeMax: input.timeMax,
    timeMin: input.timeMin,
  });
  const response = await googleWorkspaceFetch(
    ctx,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`,
    z.object({ items: z.array(z.unknown()).optional() })
  );
  return { events: response.items ?? [] };
}

export async function checkCalendarAvailability(
  ctx: ToolContext,
  input: {
    calendars: string[];
    timeMax: string;
    timeMin: string;
    timezone: string;
  }
) {
  const response = await googleWorkspaceFetch(
    ctx,
    "https://www.googleapis.com/calendar/v3/freeBusy",
    z.unknown(),
    {
      body: JSON.stringify({
        items: input.calendars.map((id) => ({ id })),
        timeMax: input.timeMax,
        timeMin: input.timeMin,
        timeZone: input.timezone,
      }),
      method: "POST",
    }
  );
  return parseCalendarAvailability(response);
}

export function parseCalendarAvailability(value: unknown) {
  const result = calendarAvailabilitySchema.parse(value);
  const failures = Object.entries(result.calendars ?? {}).flatMap(
    ([calendarId, calendar]) =>
      (calendar.errors ?? []).map(
        (error) => `${calendarId}: ${error.reason ?? error.domain ?? "unknown"}`
      )
  );
  if (failures.length > 0) {
    throw new Error(
      `Google Calendar could not read availability for ${failures.join(", ")}.`
    );
  }
  return result;
}

export async function createCalendarEvent(
  ctx: ToolContext,
  payload: z.infer<typeof calendarEventSchema>
) {
  const eventId = createHash("sha256")
    .update(`${ctx.session.id}:${ctx.callId}`)
    .digest("hex")
    .slice(0, 32);
  const path = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(payload.calendarId)}/events`;
  try {
    return await googleWorkspaceFetch(
      ctx,
      `${path}?sendUpdates=${payload.attendees.length ? "all" : "none"}`,
      z.record(z.string(), z.unknown()),
      {
        body: JSON.stringify({
          attendees: payload.attendees.map((email) => ({ email })),
          description: payload.description,
          end: { dateTime: payload.end, timeZone: payload.timezone },
          id: eventId,
          location: payload.location,
          start: { dateTime: payload.start, timeZone: payload.timezone },
          status: "confirmed",
          summary: payload.summary,
          visibility: "private",
        }),
        method: "POST",
      }
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 409")) {
      throw error;
    }
    return googleWorkspaceFetch(
      ctx,
      `${path}/${eventId}`,
      z.record(z.string(), z.unknown())
    );
  }
}

export async function searchGoogleContacts(
  ctx: ToolContext,
  query: string,
  pageSize: number
) {
  const readMask = "names,emailAddresses,phoneNumbers,organizations";
  await googleWorkspaceFetch(
    ctx,
    `https://people.googleapis.com/v1/people:searchContacts?query=&readMask=${readMask}`,
    z.unknown()
  );
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    query,
    readMask,
  });
  const response = await googleWorkspaceFetch(
    ctx,
    `https://people.googleapis.com/v1/people:searchContacts?${params}`,
    z.object({ results: z.array(z.unknown()).optional() })
  );
  return { contacts: response.results ?? [] };
}

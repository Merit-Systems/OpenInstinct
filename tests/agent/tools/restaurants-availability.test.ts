import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  parseOpenTableAvailability,
  parseResyAvailability,
  restaurantsAvailability,
} from "@/agent/tools/restaurants/availability";
import { toolContextFor } from "@/tests/helpers/tool-context";

describe("restaurant availability parsing", () => {
  it("reads only OpenTable's availability section", () => {
    const result = parseOpenTableAvailability(`
5:00 PM
### Select a time
- 5:30 PM
- 7:00 PM
- 8:30 PM
Notify me
9:45 PM
`);

    expect(result).toEqual({
      slots: [
        { label: null, time: "5:30 PM" },
        { label: null, time: "7:00 PM" },
        { label: null, time: "8:30 PM" },
      ],
      status: "available",
    });
  });

  it("pairs Resy slots with their seating or experience label", () => {
    const result = parseResyAvailability(`
## dinner
8:30 PM
VIP $99
8:45 PM
Classic $56
Notify
10:00 PM
`);

    expect(result).toEqual({
      slots: [
        { label: "VIP $99", time: "8:30 PM" },
        { label: "Classic $56", time: "8:45 PM" },
      ],
      status: "available",
    });
  });

  it("distinguishes an explicit lack of slots from an unknown layout", () => {
    expect(parseResyAvailability("No tables are available.")).toEqual({
      slots: [],
      status: "no_slots",
    });
    expect(parseOpenTableAvailability("Choose your reservation.")).toEqual({
      slots: [],
      status: "unrecognized_layout",
    });
  });
});

describe("restaurants-availability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers both providers and returns validated prefilled slots", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          creditsUsed: 2,
          data: {
            web: [
              {
                description: "Uka reservations in New York",
                title: "Uka | New York | Resy",
                url: "https://resy.com/cities/new-york-ny/venues/uka?source=search",
              },
              {
                description: "Reserve a table at Uka in New York",
                title: "Uka Restaurant - New York, NY | OpenTable",
                url: "https://www.opentable.com/r/uka-new-york?corrid=test",
              },
              {
                description: "A similarly named restaurant",
                title: "Yuka",
                url: "https://www.opentable.com/r/yuka-new-york",
              },
            ],
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          creditsUsed: 1,
          data: {
            markdown: `
# Uka
September 2, 2026 · 2 guests
## dinner
8:30 PM
VIP $99
8:45 PM
Classic $56
Notify
`,
            metadata: { title: "Uka | Resy" },
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          creditsUsed: 1,
          data: {
            markdown: `
# Uka
September 2, 2026 · 2 people
### Select a time
- 8:30 PM
- 8:45 PM
Notify me
`,
            metadata: { title: "Uka | OpenTable" },
          },
          success: true,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await restaurantsAvailability.execute(
      {
        date: "2026-09-02",
        partySize: 2,
        restaurants: [{ city: "New York, NY", name: "Uka" }],
      },
      toolContextFor({ toolName: "restaurants-availability" })
    );

    expect(result).toMatchObject({
      date: "2026-09-02",
      partySize: 2,
      restaurants: [
        {
          name: "Uka",
          status: "available",
          listings: [
            {
              bookingUrl:
                "https://resy.com/cities/new-york-ny/venues/uka?date=2026-09-02&seats=2",
              provider: "resy",
              slots: [
                { label: "VIP $99", time: "8:30 PM" },
                { label: "Classic $56", time: "8:45 PM" },
              ],
              status: "available",
            },
            {
              bookingUrl:
                "https://www.opentable.com/r/uka-new-york?dateTime=2026-09-02T19%3A00%3A00&covers=2",
              provider: "opentable",
              slots: [
                { label: null, time: "8:30 PM" },
                { label: null, time: "8:45 PM" },
              ],
              status: "available",
            },
          ],
        },
      ],
      usage: { creditsUsed: 4, scrapeRequests: 2, searchRequests: 1 },
    });

    const calls = fetchMock.mock.calls.map(([, request]) => {
      const body = z.string().parse(request?.body);
      return z.json().parse(JSON.parse(body));
    });
    expect(calls[0]).toMatchObject({
      limit: 5,
      query: "Uka New York, NY reservations",
    });
    expect(calls[1]).toMatchObject({
      maxAge: 0,
      url: "https://resy.com/cities/new-york-ny/venues/uka?date=2026-09-02&seats=2",
    });
    expect(calls[2]).toMatchObject({
      maxAge: 0,
      url: "https://www.opentable.com/r/uka-new-york?dateTime=2026-09-02T19%3A00%3A00&covers=2",
    });
  });

  it("retries an empty Resy shell and validates its rendered filter links", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          creditsUsed: 2,
          data: {
            web: [
              {
                description: "Baba on Withers reservations in Brooklyn",
                title: "Book Your Baba on Withers Reservation Now on Resy",
                url: "https://resy.com/cities/new-york-ny/venues/baba-ny",
              },
            ],
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            markdown: "StripeM-Inner",
            metadata: { creditsUsed: 1 },
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            markdown: `
# Baba on Withers
[Best of Brooklyn](https://resy.com/cities/new-york-ny/list/brooklyn?date=2026-09-03&seats=2&time=all-day)
## dinner
7:15 PM
Back Garden Lounge
7:15 PM
Dining
Notify
`,
            metadata: {
              creditsUsed: 1,
              title: "Book Your Baba on Withers Reservation Now on Resy",
            },
          },
          success: true,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await restaurantsAvailability.execute(
      {
        date: "2026-09-03",
        partySize: 2,
        restaurants: [{ city: "Brooklyn, NY", name: "Baba on Withers" }],
      },
      toolContextFor({ toolName: "restaurants-availability" })
    );

    expect(result).toMatchObject({
      restaurants: [
        {
          listings: [
            {
              dateConfirmed: true,
              partySizeConfirmed: true,
              slots: [
                { label: "Back Garden Lounge", time: "7:15 PM" },
                { label: "Dining", time: "7:15 PM" },
              ],
              status: "available",
            },
          ],
          status: "available",
        },
      ],
      usage: { creditsUsed: 4, scrapeRequests: 2, searchRequests: 1 },
    });

    const retryBody = z.string().parse(fetchMock.mock.calls[2]?.[1]?.body);
    expect(z.json().parse(JSON.parse(retryBody))).toMatchObject({
      waitFor: 750,
    });
  });
});

function jsonResponse(value: z.input<typeof z.json>) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

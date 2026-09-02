import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@/agent/lib/mode";
import { env } from "@/env";

const firecrawlApi = "https://api.firecrawl.dev/v2";
const providerSchema = z.enum(["resy", "opentable"]);
const listingStatusSchema = z.enum([
  "available",
  "identity_ambiguous",
  "identity_mismatch",
  "no_slots",
  "scrape_failed",
  "unrecognized_layout",
]);

const inputSchema = z.object({
  date: z.iso.date(),
  partySize: z.number().int().min(1).max(20),
  restaurants: z
    .array(
      z.object({
        city: z.string().trim().min(1).max(200).default("New York, NY"),
        name: z.string().trim().min(1).max(200),
      })
    )
    .min(1)
    .max(10),
});

const slotSchema = z.object({
  label: z.string().nullable(),
  time: z.string(),
});

const listingSchema = z.object({
  bookingUrl: z.url(),
  dateConfirmed: z.boolean(),
  error: z.string().nullable(),
  partySizeConfirmed: z.boolean(),
  provider: providerSchema,
  scrapedAt: z.iso.datetime().nullable(),
  slots: z.array(slotSchema),
  sourceUrl: z.url(),
  status: listingStatusSchema,
  title: z.string(),
});

const restaurantResultSchema = z.object({
  city: z.string(),
  error: z.string().nullable(),
  listings: z.array(listingSchema),
  name: z.string(),
  status: z.enum([
    "available",
    "failed",
    "identity_ambiguous",
    "no_slots",
    "not_discovered",
    "partial_failure",
  ]),
});

const outputSchema = z.object({
  date: z.iso.date(),
  lookedUpAt: z.iso.datetime(),
  partySize: z.number().int(),
  restaurants: z.array(restaurantResultSchema),
  usage: z.object({
    creditsUsed: z.number().nonnegative().nullable(),
    scrapeRequests: z.number().int().nonnegative(),
    searchRequests: z.number().int().nonnegative(),
  }),
});

const searchResponseSchema = z.object({
  creditsUsed: z.number().nonnegative().optional(),
  data: z.object({
    web: z.array(
      z.object({
        description: z.string().optional().default(""),
        title: z.string().optional().default(""),
        url: z.url(),
      })
    ),
  }),
  success: z.literal(true),
});

const scrapeResponseSchema = z.object({
  creditsUsed: z.number().nonnegative().optional(),
  data: z.object({
    markdown: z.string(),
    metadata: z
      .object({
        creditsUsed: z.number().nonnegative().optional(),
        sourceURL: z.string().optional(),
        title: z.string().optional(),
      })
      .optional(),
  }),
  success: z.literal(true),
});

const candidateSchema = z.object({
  description: z.string(),
  provider: providerSchema,
  score: z.number().int(),
  title: z.string(),
  url: z.url(),
});

interface FirecrawlScrapeRequest {
  readonly formats: readonly ["markdown"];
  readonly location: {
    readonly country: "US";
    readonly languages: readonly ["en-US"];
  };
  readonly maxAge: 0;
  readonly onlyMainContent: true;
  readonly timeout: number;
  readonly url: string;
  readonly waitFor?: number;
}

interface FirecrawlSearchRequest {
  readonly country: "US";
  readonly ignoreInvalidURLs: true;
  readonly limit: 5;
  readonly location: string;
  readonly query: string;
  readonly sources: readonly ["web"];
  readonly timeout: number;
}

interface FirecrawlUsage {
  creditsReported: boolean;
  creditsUsed: number;
  scrapeRequests: number;
  searchRequests: number;
}

export const restaurantsAvailability = defineTool({
  description:
    "Find current public reservation slots for one or more named restaurants on Resy and OpenTable. This makes paid requests using the configured Firecrawl account, validates restaurant identity plus the requested date and party size, and returns timestamped prefilled booking links. It never makes a reservation. Use the reported Firecrawl credits after the call for usage visibility.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const apiKey = env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Firecrawl is not configured.");

    const usage = {
      creditsReported: true,
      creditsUsed: 0,
      scrapeRequests: 0,
      searchRequests: 0,
    };
    const restaurants = await Promise.all(
      input.restaurants.map(async (restaurant) => {
        try {
          return await lookupRestaurant(
            apiKey,
            restaurant,
            input.date,
            input.partySize,
            usage,
            context.abortSignal
          );
        } catch (error) {
          usage.creditsReported = false;
          return {
            city: restaurant.city,
            error:
              error instanceof Error
                ? error.message
                : "Restaurant lookup failed.",
            listings: [],
            name: restaurant.name,
            status: "failed" as const,
          };
        }
      })
    );

    return outputSchema.parse({
      date: input.date,
      lookedUpAt: new Date().toISOString(),
      partySize: input.partySize,
      restaurants,
      usage: {
        creditsUsed: usage.creditsReported ? usage.creditsUsed : null,
        scrapeRequests: usage.scrapeRequests,
        searchRequests: usage.searchRequests,
      },
    });
  },
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (!env.FIRECRAWL_API_KEY) return null;
      return resolveModeValue(context, {
        interactive: restaurantsAvailability,
        "scheduled-worker": restaurantsAvailability,
      });
    },
  },
});

async function lookupRestaurant(
  apiKey: string,
  restaurant: z.infer<typeof inputSchema>["restaurants"][number],
  date: string,
  partySize: number,
  usage: FirecrawlUsage,
  signal?: AbortSignal
): Promise<z.infer<typeof restaurantResultSchema>> {
  usage.searchRequests += 1;
  const search = searchResponseSchema.parse(
    await firecrawlRequest(
      apiKey,
      "/search",
      {
        country: "US",
        ignoreInvalidURLs: true,
        limit: 5,
        location: restaurant.city,
        query: `${restaurant.name} ${restaurant.city} reservations`,
        sources: ["web"],
        timeout: 30_000,
      },
      signal
    )
  );
  recordCredits(usage, search.creditsUsed);

  const candidates = rankedCandidates(search.data.web, restaurant);
  if (candidates.length === 0) {
    return restaurantResultSchema.parse({
      city: restaurant.city,
      error: null,
      listings: [],
      name: restaurant.name,
      status: "not_discovered" as const,
    });
  }

  const selected = selectProviderCandidates(candidates);
  const pendingListings: Promise<Listing>[] = [];
  for (const selection of selected) {
    if (selection.length > 1) {
      pendingListings.push(
        ...selection.map((candidate) =>
          Promise.resolve(ambiguousListing(candidate, date, partySize))
        )
      );
      continue;
    }
    const candidate = selection[0];
    if (candidate) {
      pendingListings.push(
        scrapeListing(
          apiKey,
          candidate,
          restaurant.name,
          date,
          partySize,
          usage,
          signal
        )
      );
    }
  }
  const listings = await Promise.all(pendingListings);

  return restaurantResultSchema.parse({
    city: restaurant.city,
    error: null,
    listings,
    name: restaurant.name,
    status: restaurantStatus(listings),
  });
}

async function scrapeListing(
  apiKey: string,
  candidate: Candidate,
  restaurantName: string,
  date: string,
  partySize: number,
  usage: FirecrawlUsage,
  signal?: AbortSignal
): Promise<Listing> {
  const bookingUrl = bookingUrlFor(
    candidate.provider,
    candidate.url,
    date,
    partySize
  );
  try {
    return await scrapeListingAttempt({
      apiKey,
      attempt: 0,
      bookingUrl,
      candidate,
      date,
      partySize,
      restaurantName,
      signal,
      usage,
    });
  } catch (error) {
    usage.creditsReported = false;
    return listingSchema.parse({
      bookingUrl,
      dateConfirmed: false,
      error:
        error instanceof Error ? error.message : "Restaurant lookup failed.",
      partySizeConfirmed: false,
      provider: candidate.provider,
      scrapedAt: null,
      slots: [],
      sourceUrl: candidate.url,
      status: "scrape_failed" as const,
      title: candidate.title,
    });
  }
}

async function scrapeListingAttempt({
  apiKey,
  attempt,
  bookingUrl,
  candidate,
  date,
  partySize,
  restaurantName,
  signal,
  usage,
}: {
  readonly apiKey: string;
  readonly attempt: 0 | 1;
  readonly bookingUrl: string;
  readonly candidate: Candidate;
  readonly date: string;
  readonly partySize: number;
  readonly restaurantName: string;
  readonly signal?: AbortSignal;
  readonly usage: FirecrawlUsage;
}): Promise<Listing> {
  usage.scrapeRequests += 1;
  const baseRequest: FirecrawlScrapeRequest = {
    formats: ["markdown"],
    location: { country: "US", languages: ["en-US"] },
    maxAge: 0,
    onlyMainContent: true,
    timeout: 30_000,
    url: bookingUrl,
  };
  const request: FirecrawlScrapeRequest =
    attempt === 1 ? { ...baseRequest, waitFor: 750 } : baseRequest;
  const scrapedAt = new Date().toISOString();
  const scrape = scrapeResponseSchema.parse(
    await firecrawlRequest(apiKey, "/scrape", request, signal)
  );
  recordCredits(usage, scrape.creditsUsed ?? scrape.data.metadata?.creditsUsed);

  const content = scrape.data.markdown;
  const parsed = parseProviderAvailability(candidate.provider, content);
  const identityConfirmed = textMatchesName(
    `${scrape.data.metadata?.title ?? ""}\n${content.slice(0, 8_000)}`,
    restaurantName
  );
  const dateConfirmed = contentConfirmsDate(content, date);
  const partySizeConfirmed = contentConfirmsPartySize(content, partySize);
  if (
    attempt === 0 &&
    shouldRetryScrape(
      content,
      parsed.status,
      identityConfirmed,
      dateConfirmed,
      partySizeConfirmed
    )
  ) {
    return scrapeListingAttempt({
      apiKey,
      attempt: 1,
      bookingUrl,
      candidate,
      date,
      partySize,
      restaurantName,
      signal,
      usage,
    });
  }

  const validationPassed =
    identityConfirmed && dateConfirmed && partySizeConfirmed;
  const status = !identityConfirmed
    ? "identity_mismatch"
    : !validationPassed
      ? "unrecognized_layout"
      : parsed.status;

  return listingSchema.parse({
    bookingUrl,
    dateConfirmed,
    error: validationPassed
      ? null
      : validationError(identityConfirmed, dateConfirmed, partySizeConfirmed),
    partySizeConfirmed,
    provider: candidate.provider,
    scrapedAt,
    slots: parsed.slots,
    sourceUrl: candidate.url,
    status,
    title: candidate.title,
  });
}

async function firecrawlRequest(
  apiKey: string,
  path: "/scrape" | "/search",
  body: FirecrawlScrapeRequest | FirecrawlSearchRequest,
  signal?: AbortSignal
) {
  const response = await fetch(`${firecrawlApi}${path}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Firecrawl ${path.slice(1)} failed with HTTP ${String(response.status)}.`
    );
  }
  const payload: unknown = await response.json();
  return z.json().parse(payload);
}

function rankedCandidates(
  results: z.infer<typeof searchResponseSchema>["data"]["web"],
  restaurant: { readonly city: string; readonly name: string }
) {
  return results
    .flatMap((result) => {
      const provider = providerForUrl(result.url);
      if (!provider || !hasProviderListingPath(provider, result.url)) return [];
      const titleMatch = textMatchesName(result.title, restaurant.name);
      const descriptionMatch = textMatchesName(
        result.description,
        restaurant.name
      );
      const pathMatch = textMatchesName(
        decodeURIComponent(new URL(result.url).pathname),
        restaurant.name
      );
      if (!titleMatch && !descriptionMatch && !pathMatch) return [];
      const cityMatch = textMatchesLocation(
        `${result.title} ${result.description}`,
        restaurant.city
      );
      return [
        candidateSchema.parse({
          ...result,
          provider,
          score:
            (titleMatch ? 10 : 0) +
            (pathMatch ? 6 : 0) +
            (descriptionMatch ? 4 : 0) +
            (cityMatch ? 2 : 0),
        }),
      ];
    })
    .toSorted((left, right) => right.score - left.score);
}

function selectProviderCandidates(candidates: readonly Candidate[]) {
  return providerSchema.options.flatMap((provider) => {
    const matches = candidates.filter(
      (candidate) => candidate.provider === provider
    );
    const bestScore = matches[0]?.score;
    if (bestScore === undefined) return [];
    const best = matches.filter((candidate) => candidate.score === bestScore);
    const unique = new Map(
      best.map((candidate) => [canonicalListingUrl(candidate.url), candidate])
    );
    return [[...unique.values()]];
  });
}

function ambiguousListing(
  candidate: Candidate,
  date: string,
  partySize: number
): Listing {
  return listingSchema.parse({
    bookingUrl: bookingUrlFor(
      candidate.provider,
      candidate.url,
      date,
      partySize
    ),
    dateConfirmed: false,
    error:
      "Multiple equally strong listings matched this restaurant and provider.",
    partySizeConfirmed: false,
    provider: candidate.provider,
    scrapedAt: null,
    slots: [],
    sourceUrl: candidate.url,
    status: "identity_ambiguous" as const,
    title: candidate.title,
  });
}

function providerForUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
  if (hostname === "resy.com") return "resy" as const;
  if (hostname === "opentable.com") return "opentable" as const;
  return undefined;
}

function hasProviderListingPath(provider: Provider, value: string) {
  const pathname = new URL(value).pathname.toLowerCase();
  return provider === "resy"
    ? pathname.includes("/venues/")
    : /^\/r\/[^/]+\/?$/u.test(pathname);
}

function canonicalListingUrl(value: string) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase().replace(/^www\./u, "")}${url.pathname.replace(/\/$/u, "").toLowerCase()}`;
}

function bookingUrlFor(
  provider: Provider,
  value: string,
  date: string,
  partySize: number
) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (provider === "resy") {
    url.searchParams.set("date", date);
    url.searchParams.set("seats", String(partySize));
  } else {
    url.searchParams.set("dateTime", `${date}T19:00:00`);
    url.searchParams.set("covers", String(partySize));
  }
  return url.toString();
}

export function parseProviderAvailability(provider: Provider, content: string) {
  return provider === "opentable"
    ? parseOpenTableAvailability(content)
    : parseResyAvailability(content);
}

export function parseOpenTableAvailability(content: string) {
  const section = /###\s+Select a time\s*([\s\S]*?)\s*Notify me/iu.exec(
    content
  )?.[1];
  if (section === undefined) {
    return pageSaysNoAvailability(content)
      ? { slots: [], status: "no_slots" as const }
      : { slots: [], status: "unrecognized_layout" as const };
  }
  const times = [
    ...section.matchAll(/^[-*]\s+(\d{1,2}:\d{2}\s+[AP]M)\s*$/gimu),
  ].map((match) => match[1]);
  return {
    slots: uniqueTimes(times).map((time) => ({ label: null, time })),
    status: times.length > 0 ? ("available" as const) : ("no_slots" as const),
  };
}

export function parseResyAvailability(content: string) {
  const headings = [
    ...content.matchAll(
      /^##\s+(breakfast|brunch|lunch|dinner|late night)\s*$/gimu
    ),
  ];
  if (headings.length === 0) {
    return pageSaysNoAvailability(content)
      ? { slots: [], status: "no_slots" as const }
      : { slots: [], status: "unrecognized_layout" as const };
  }

  const slots = headings.flatMap((heading, index) => {
    const start = heading.index + heading[0].length;
    const nextStart = headings[index + 1]?.index ?? content.length;
    const notifyIndex = content.slice(start, nextStart).search(/^Notify\b/imu);
    const end = notifyIndex >= 0 ? start + notifyIndex : nextStart;
    return resySlotsFromSection(content.slice(start, end));
  });
  return {
    slots: uniqueSlots(slots),
    status: slots.length > 0 ? ("available" as const) : ("no_slots" as const),
  };
}

function resySlotsFromSection(section: string) {
  const lines = section
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^[-*]\s+/u, ""))
    .filter(Boolean);
  return lines.flatMap((line, index) => {
    const time = /^(\d{1,2}:\d{2}\s+[AP]M)$/iu.exec(line)?.[1];
    if (!time) return [];
    const following = lines[index + 1];
    const label =
      following && !/^\d{1,2}:\d{2}\s+[AP]M$/iu.test(following)
        ? following
        : null;
    return [{ label, time: normalizeTime(time) }];
  });
}

function uniqueTimes(times: readonly (string | undefined)[]) {
  return [
    ...new Set(times.flatMap((time) => (time ? [normalizeTime(time)] : []))),
  ];
}

function uniqueSlots(slots: readonly z.infer<typeof slotSchema>[]) {
  const unique = new Map(
    slots.map((slot) => [`${slot.time}\0${slot.label ?? ""}`, slot])
  );
  return [...unique.values()];
}

function normalizeTime(value: string) {
  return value.trim().replace(/\s+/gu, " ").toUpperCase();
}

function pageSaysNoAvailability(content: string) {
  return /\b(?:fully booked|no (?:available )?(?:reservations|tables|times|timeslots)|nothing available|not available for the selected)\b/iu.test(
    content
  );
}

function contentConfirmsDate(content: string, date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const labels = [
    date,
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(parsed),
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(parsed),
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(parsed),
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(parsed),
  ];
  return labels.some((label) =>
    content.toLowerCase().includes(label.toLowerCase())
  );
}

function contentConfirmsPartySize(content: string, partySize: number) {
  const value = String(partySize);
  return (
    new RegExp(
      `\\b(?:party of\\s+)?${value}\\s+(?:diners?|guests?|people|persons?)\\b`,
      "iu"
    ).test(content) ||
    new RegExp(`[?&](?:covers|seats)=${value}\\b`, "iu").test(content)
  );
}

function shouldRetryScrape(
  content: string,
  status: "available" | "no_slots" | "unrecognized_layout",
  identityConfirmed: boolean,
  dateConfirmed: boolean,
  partySizeConfirmed: boolean
) {
  return (
    status === "unrecognized_layout" &&
    (content.trim().length < 500 ||
      (!identityConfirmed && !dateConfirmed && !partySizeConfirmed))
  );
}

function textMatchesName(text: string, name: string) {
  const normalizedText = ` ${normalizeIdentity(text)} `;
  const normalizedName = normalizeIdentity(name);
  return (
    normalizedName.length >= 3 && normalizedText.includes(` ${normalizedName} `)
  );
}

function textMatchesLocation(text: string, location: string) {
  const normalizedText = ` ${normalizeIdentity(text)} `;
  const tokens = normalizeIdentity(location)
    .split(" ")
    .filter((token) => token.length >= 2);
  return tokens.some((token) => normalizedText.includes(` ${token} `));
}

function normalizeIdentity(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function restaurantStatus(listings: readonly Listing[]) {
  if (listings.some((listing) => listing.status === "available")) {
    return listings.every((listing) =>
      ["available", "no_slots"].includes(listing.status)
    )
      ? ("available" as const)
      : ("partial_failure" as const);
  }
  if (
    listings.length > 0 &&
    listings.every((listing) => listing.status === "no_slots")
  ) {
    return "no_slots" as const;
  }
  if (listings.some((listing) => listing.status === "identity_ambiguous")) {
    return "identity_ambiguous" as const;
  }
  return "failed" as const;
}

function validationError(
  identityConfirmed: boolean,
  dateConfirmed: boolean,
  partySizeConfirmed: boolean
) {
  const missing = [
    identityConfirmed ? null : "restaurant identity",
    dateConfirmed ? null : "requested date",
    partySizeConfirmed ? null : "party size",
  ].filter((value) => value !== null);
  return `The rendered page did not confirm ${missing.join(", ")}.`;
}

function recordCredits(usage: FirecrawlUsage, credits: number | undefined) {
  if (credits === undefined) {
    usage.creditsReported = false;
    return;
  }
  usage.creditsUsed += credits;
}

type Candidate = z.infer<typeof candidateSchema>;
type Listing = z.infer<typeof listingSchema>;
type Provider = z.infer<typeof providerSchema>;

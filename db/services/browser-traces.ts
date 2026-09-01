import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import {
  browserTraceDomains,
  browserTraceEvents,
  browserTraces,
  db,
} from "@/db";

type CompletedBrowserTraceStatus =
  | "success"
  | "failure"
  | "error"
  | "cancelled";

const traceHistoryPageSize = 25;

const traceCursorSchema = z.object({
  sessionId: z.string().min(1),
  startedAt: z.string().min(1),
});

function decodeTraceCursor(cursor: string) {
  try {
    return traceCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
  } catch {
    throw new Error("Invalid browser trace cursor.");
  }
}

function encodeTraceCursor(boundary: z.infer<typeof traceCursorSchema>) {
  return Buffer.from(JSON.stringify(boundary)).toString("base64url");
}

export async function listBrowserTraces(scope: AccessScope, cursor?: string) {
  const boundary = cursor === undefined ? undefined : decodeTraceCursor(cursor);
  const rows = await db
    .select({
      completedAt: browserTraces.completedAt,
      durationMs: browserTraces.durationMs,
      resultMessage: browserTraces.resultMessage,
      sessionId: browserTraces.sessionId,
      startedAt: browserTraces.startedAt,
      status: browserTraces.status,
      task: browserTraces.task,
    })
    .from(browserTraces)
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        boundary
          ? sql`(${browserTraces.startedAt}, ${browserTraces.sessionId}) < (${boundary.startedAt}, ${boundary.sessionId})`
          : undefined
      )
    )
    .orderBy(desc(browserTraces.startedAt), desc(browserTraces.sessionId))
    .limit(traceHistoryPageSize + 1);

  const page = rows.slice(0, traceHistoryPageSize);
  const last = page.at(-1);
  const domainRows =
    page.length > 0
      ? await db
          .select({
            domain: browserTraceDomains.domain,
            traceSessionId: browserTraceDomains.traceSessionId,
          })
          .from(browserTraceDomains)
          .where(
            inArray(
              browserTraceDomains.traceSessionId,
              page.map((row) => row.sessionId)
            )
          )
          .orderBy(browserTraceDomains.domain)
      : [];
  const domainsByTrace = new Map<string, string[]>();
  for (const row of domainRows) {
    const domains = domainsByTrace.get(row.traceSessionId) ?? [];
    domains.push(row.domain);
    domainsByTrace.set(row.traceSessionId, domains);
  }

  return {
    nextCursor:
      rows.length > page.length && last ? encodeTraceCursor(last) : null,
    traces: page.map((row) =>
      Object.assign({}, row, {
        domains: domainsByTrace.get(row.sessionId) ?? [],
      })
    ),
  };
}

export type BrowserTracePage = Awaited<ReturnType<typeof listBrowserTraces>>;

export async function readBrowserTrace(scope: AccessScope, sessionId: string) {
  const rows = await db
    .select({
      completedAt: browserTraces.completedAt,
      durationMs: browserTraces.durationMs,
      resultMessage: browserTraces.resultMessage,
      sessionId: browserTraces.sessionId,
      startedAt: browserTraces.startedAt,
      status: browserTraces.status,
      task: browserTraces.task,
    })
    .from(browserTraces)
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        eq(browserTraces.sessionId, sessionId)
      )
    )
    .limit(1);
  const trace = rows[0];
  if (!trace) return undefined;

  const domains = await db
    .select({ domain: browserTraceDomains.domain })
    .from(browserTraceDomains)
    .where(eq(browserTraceDomains.traceSessionId, sessionId))
    .orderBy(browserTraceDomains.domain);
  return { ...trace, domains: domains.map((row) => row.domain) };
}

export async function beginBrowserTrace(
  scope: AccessScope,
  record: { sessionId: string; task: string; startedAt: string }
) {
  await db
    .insert(browserTraces)
    .values({
      createdByUserId: scope.userId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
      status: "running",
      task: record.task,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      set: { completedAt: null, durationMs: null, status: "running" },
      target: browserTraces.sessionId,
    });
}

export async function completeBrowserTrace(
  scope: AccessScope,
  sessionId: string,
  outcome: {
    completedAt: string;
    resultMessage?: string;
    status: CompletedBrowserTraceStatus;
  }
) {
  await db
    .update(browserTraces)
    .set({
      completedAt: outcome.completedAt,
      durationMs: sql`GREATEST(0, ROUND(EXTRACT(EPOCH FROM (${outcome.completedAt}::timestamptz - ${browserTraces.startedAt}::timestamptz)) * 1000))::int`,
      resultMessage: outcome.resultMessage,
      status: outcome.status,
    })
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        eq(browserTraces.sessionId, sessionId)
      )
    );
}

export async function recordBrowserTraceEvents(
  scope: AccessScope,
  traceSessionId: string,
  events: readonly {
    at: string;
    detail: string;
    id: string;
    label: string;
    type: string;
  }[]
) {
  if (events.length === 0) return;
  const owned = await db
    .select({ sessionId: browserTraces.sessionId })
    .from(browserTraces)
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        eq(browserTraces.sessionId, traceSessionId)
      )
    )
    .limit(1);
  if (owned.length === 0) return;

  await db
    .insert(browserTraceEvents)
    .values(events.map((event) => ({ ...event, traceSessionId })))
    .onConflictDoNothing({ target: browserTraceEvents.id });
}

const traceEventReadLimit = 2000;

export async function listBrowserTraceEvents(
  scope: AccessScope,
  traceSessionId: string
) {
  return db
    .select({
      at: browserTraceEvents.at,
      detail: browserTraceEvents.detail,
      id: browserTraceEvents.id,
      label: browserTraceEvents.label,
    })
    .from(browserTraceEvents)
    .innerJoin(
      browserTraces,
      eq(browserTraces.sessionId, browserTraceEvents.traceSessionId)
    )
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        eq(browserTraceEvents.traceSessionId, traceSessionId)
      )
    )
    .orderBy(asc(browserTraceEvents.id))
    .limit(traceEventReadLimit);
}

export async function recordBrowserTraceDomains(
  scope: AccessScope,
  traceSessionId: string,
  domains: readonly string[]
) {
  if (domains.length === 0) return;
  const owned = await db
    .select({ sessionId: browserTraces.sessionId })
    .from(browserTraces)
    .where(
      and(
        eq(browserTraces.workspaceId, scope.workspaceId),
        eq(browserTraces.sessionId, traceSessionId)
      )
    )
    .limit(1);
  if (owned.length === 0) return;

  const firstSeenAt = new Date().toISOString();
  await db
    .insert(browserTraceDomains)
    .values(
      [...new Set(domains)].map((domain) => ({
        domain,
        firstSeenAt,
        traceSessionId,
      }))
    )
    .onConflictDoNothing({
      target: [browserTraceDomains.traceSessionId, browserTraceDomains.domain],
    });
}

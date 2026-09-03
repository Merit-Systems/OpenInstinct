import { Client, type MessageStreamEvent } from "eve/client";
import { z } from "zod";

const eventsPerRead = 128;
const messagesPerPage = 4;
const tailIndexHeader = "x-eve-stream-tail-index";
const client = new Client({ host: "" });
const messageStreamEventSchema = z.custom<MessageStreamEvent>(
  (value) =>
    z
      .object({
        data: z.unknown(),
        meta: z.object({ at: z.string(), id: z.string() }).loose(),
        type: z.string(),
      })
      .loose()
      .safeParse(value).success
);

export interface SessionHistoryPage {
  readonly endIndex: number;
  readonly events: readonly MessageStreamEvent[];
  readonly startIndex: number;
}

export async function readLatestSessionHistory(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionHistoryPage> {
  const response = await fetch(
    sessionStreamUrl(sessionId, {
      includeTailIndex: true,
      startIndex: -eventsPerRead,
    }),
    { cache: "no-store", signal }
  );
  if (!response.ok) throw await streamResponseError(response);

  const tailIndex = readTailIndex(response);
  const latestEvents = await readNdjsonEvents(response);
  const endIndex = tailIndex + 1;
  const startIndex = Math.max(0, endIndex - latestEvents.length);

  return await extendToMessageBoundary(
    { endIndex, events: latestEvents, startIndex },
    sessionId,
    signal
  );
}

export async function readOlderSessionHistory(
  sessionId: string,
  before: number,
  signal?: AbortSignal
): Promise<SessionHistoryPage> {
  return await extendToMessageBoundary(
    { endIndex: before, events: [], startIndex: before },
    sessionId,
    signal
  );
}

async function extendToMessageBoundary(
  initial: SessionHistoryPage,
  sessionId: string,
  signal?: AbortSignal
) {
  let page = initial;

  while (
    page.startIndex > 0 &&
    receivedMessageCount(page.events) < messagesPerPage
  ) {
    /* oxlint-disable-next-line eslint/no-await-in-loop -- Each backward read starts at the cursor returned by the preceding read. */
    const older = await readEventChunk(sessionId, page.startIndex, signal);
    page = {
      endIndex: page.endIndex,
      events: [...older.events, ...page.events],
      startIndex: older.startIndex,
    };
  }

  const messageIndexes = page.events.flatMap((event, index) =>
    event.type === "message.received" ? [index] : []
  );
  const firstMessage = messageIndexes.at(-messagesPerPage);
  if (firstMessage === undefined || firstMessage === 0) return page;

  return {
    ...page,
    events: page.events.slice(firstMessage),
    startIndex: page.startIndex + firstMessage,
  };
}

async function readEventChunk(
  sessionId: string,
  before: number,
  signal?: AbortSignal
): Promise<SessionHistoryPage> {
  const startIndex = Math.max(0, before - eventsPerRead);
  const eventLimit = before - startIndex;
  const session = client.sessions.attach(sessionId, {
    streamIndex: startIndex,
  });
  const events: MessageStreamEvent[] = [];

  for await (const event of session.stream({
    follow: false,
    signal,
    startIndex,
  })) {
    events.push(event);
    if (events.length === eventLimit) break;
  }

  return { endIndex: before, events, startIndex };
}

function receivedMessageCount(events: readonly MessageStreamEvent[]) {
  return events.reduce(
    (count, event) => count + Number(event.type === "message.received"),
    0
  );
}

function sessionStreamUrl(
  sessionId: string,
  options: { readonly includeTailIndex: boolean; readonly startIndex: number }
) {
  const search = new URLSearchParams({
    startIndex: options.startIndex.toString(),
  });
  if (options.includeTailIndex) search.set("includeTailIndex", "1");
  return `/eve/v1/session/${encodeURIComponent(sessionId)}/stream?${search}`;
}

function readTailIndex(response: Response) {
  const value = response.headers.get(tailIndexHeader);
  const index = value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(index) || index < -1) {
    throw new Error("The session stream did not report a valid tail index.");
  }
  return index;
}

async function readNdjsonEvents(response: Response) {
  const body = await response.text();
  const events: MessageStreamEvent[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    events.push(messageStreamEventSchema.parse(JSON.parse(line)));
  }
  return events;
}

async function streamResponseError(response: Response) {
  const body = await response.text();
  return new Error(
    body.trim() ||
      `Unable to read the session stream (${String(response.status)}).`
  );
}

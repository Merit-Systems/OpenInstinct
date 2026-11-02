import type { SessionStreamEvent } from "eve/client";
import type { SessionReader } from "eve/sessions";

const linesPerRead = 128;
const turnsPerPage = 4;

/** A contiguous window of a session's stream, addressed by stored line. */
export interface SessionHistoryPage {
  /** The next line to read after this page. */
  readonly endIndex: number;
  readonly events: readonly SessionStreamEvent[];
  /** The first line this page holds. */
  readonly startIndex: number;
}

export async function readLatestSessionHistory(
  reader: SessionReader,
  signal?: AbortSignal
): Promise<SessionHistoryPage> {
  const events = await readLines(reader, -linesPerRead, undefined, signal);
  const last = events.at(-1);
  const endIndex = last ? lineAfter(last) : 0;
  const startIndex = events[0]?.meta.position.line ?? endIndex;

  return await extendToTurnBoundary(
    { endIndex, events, startIndex },
    reader,
    signal
  );
}

export async function readOlderSessionHistory(
  reader: SessionReader,
  before: number,
  signal?: AbortSignal
): Promise<SessionHistoryPage> {
  return await extendToTurnBoundary(
    { endIndex: before, events: [], startIndex: before },
    reader,
    signal
  );
}

/** The line a reader resumes from after `event`, once its line is complete. */
function lineAfter(event: SessionStreamEvent) {
  return event.meta.next ?? event.meta.position.line + 1;
}

/** Appends streamed events once each, keyed by their stored position. */
export function appendHistoryEvent(
  page: SessionHistoryPage,
  event: SessionStreamEvent
): SessionHistoryPage {
  const endIndex =
    event.meta.endOfLine === false
      ? page.endIndex
      : Math.max(page.endIndex, lineAfter(event));
  const { line, index } = event.meta.position;
  const known = page.events.some(
    (candidate) =>
      candidate.meta.position.line === line &&
      candidate.meta.position.index === index
  );
  return known
    ? { ...page, endIndex }
    : { ...page, endIndex, events: [...page.events, event] };
}

async function extendToTurnBoundary(
  initial: SessionHistoryPage,
  reader: SessionReader,
  signal?: AbortSignal
) {
  let page = initial;

  while (
    page.startIndex > 0 &&
    startedTurnLines(page.events).length < turnsPerPage
  ) {
    const from = Math.max(0, page.startIndex - linesPerRead);
    /* oxlint-disable-next-line eslint/no-await-in-loop -- Each backward read starts at the cursor returned by the preceding read. */
    const older = await readLines(reader, from, page.startIndex, signal);
    page = {
      endIndex: page.endIndex,
      events: [...older, ...page.events],
      startIndex: from,
    };
  }

  // Start the page on a whole turn, so the fold sees each turn it renders open.
  const firstTurnLine = startedTurnLines(page.events).at(-turnsPerPage);
  if (firstTurnLine === undefined || firstTurnLine <= page.startIndex) {
    return page;
  }

  return {
    ...page,
    events: page.events.filter(
      (event) => event.meta.position.line >= firstTurnLine
    ),
    startIndex: firstTurnLine,
  };
}

async function readLines(
  reader: SessionReader,
  startIndex: number,
  before: number | undefined,
  signal?: AbortSignal
) {
  const events: SessionStreamEvent[] = [];

  for await (const event of reader.stream({
    follow: false,
    signal,
    startIndex,
  })) {
    if (before !== undefined && event.meta.position.line >= before) break;
    events.push(event);
  }

  return events;
}

function startedTurnLines(events: readonly SessionStreamEvent[]) {
  return events.flatMap((event) =>
    event.type === "turn.started" ? [event.meta.position.line] : []
  );
}

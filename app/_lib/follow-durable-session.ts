import type { ClientSession, MessageStreamEvent } from "eve/client";

const IDLE_RECONNECT_DELAY_MS = 250;

/**
 * Follows the complete durable session stream. Unlike a turn response, this
 * deliberately does not stop when the session reaches a waiting boundary.
 */
export async function followDurableSession(
  session: Pick<ClientSession, "state" | "stream">,
  onEvent: (event: MessageStreamEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const seenEventIds = new Set<string>();

  while (!signal.aborted) {
    const startIndex = session.state.streamIndex;

    for await (const event of session.stream({ signal })) {
      const eventId = event.meta.id;
      if (!eventId || !seenEventIds.has(eventId)) {
        if (eventId) seenEventIds.add(eventId);
        onEvent(event);
      }
    }

    // Eve's stream may return after its bounded idle reconnect policy. Reopen
    // from the same session handle's advanced cursor so future task events are
    // still observed while this chat remains mounted.
    if (session.state.streamIndex === startIndex) {
      await waitForReconnect(signal);
    }
  }
}

async function waitForReconnect(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, IDLE_RECONNECT_DELAY_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

import type { ClientSession, MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { followDurableSession } from "./follow-durable-session";

describe("durable chat session stream", () => {
  it("keeps consuming after background-task waiting boundaries", async () => {
    const batches = [
      [
        messageEvent("background-update", "Background task update"),
        waitingEvent("background-update-wait"),
      ],
      [
        messageEvent("background-complete", "Background task complete"),
        waitingEvent("background-complete-wait"),
        messageEvent("foreground-current", "Current user message"),
        waitingEvent("foreground-message-wait"),
      ],
    ];
    const abortController = new AbortController();
    const receivedMessages: string[] = [];
    let streamIndex = 0;
    let streamCalls = 0;

    const session = {
      get state() {
        return { sessionId: "session-1", streamIndex };
      },
      stream() {
        const batch = batches[streamCalls] ?? [];
        streamCalls += 1;

        return (async function* () {
          for (const event of batch) {
            streamIndex += 1;
            yield event;
          }
        })();
      },
    } satisfies Pick<ClientSession, "state" | "stream">;

    await followDurableSession(
      session,
      (event) => {
        if (event.type === "message.received") {
          receivedMessages.push(event.data.message);
        }
        if (event.meta.id === "foreground-message-wait") {
          abortController.abort();
        }
      },
      abortController.signal
    );

    expect(receivedMessages).toEqual([
      "Background task update",
      "Background task complete",
      "Current user message",
    ]);
    expect(streamCalls).toBe(2);
  });
});

function messageEvent(id: string, message: string): MessageStreamEvent {
  return {
    data: { message, sequence: 0, turnId: id },
    meta: { at: "2026-08-27T00:00:00.000Z", id },
    type: "message.received",
  };
}

function waitingEvent(id: string): MessageStreamEvent {
  return {
    data: {
      continuationToken: `continuation-${id}`,
      wait: "next-user-message",
    },
    meta: { at: "2026-08-27T00:00:00.000Z", id },
    type: "session.waiting",
  };
}

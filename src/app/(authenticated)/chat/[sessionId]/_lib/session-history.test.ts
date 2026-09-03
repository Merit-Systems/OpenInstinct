import type { MessageStreamEvent } from "eve/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLatestSessionHistory } from "./session-history";

describe("session history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a bounded tail and keeps only the latest four message turns", async () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      receivedMessage(index)
    );
    const fetchMock = vi.fn<() => Promise<Response>>(() =>
      Promise.resolve(
        new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
          headers: { "x-eve-stream-tail-index": "5" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = await readLatestSessionHistory("session/one");

    expect(fetchMock).toHaveBeenCalledWith(
      "/eve/v1/session/session%2Fone/stream?startIndex=-128&includeTailIndex=1",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(history).toEqual({
      endIndex: 6,
      events: events.slice(2),
      startIndex: 2,
    });
  });

  it("rejects a stream response without a durable tail cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(() => Promise.resolve(new Response("\n")))
    );

    await expect(readLatestSessionHistory("missing-tail")).rejects.toThrow(
      "valid tail index"
    );
  });
});

function receivedMessage(index: number): MessageStreamEvent {
  return {
    data: {
      message: `Message ${String(index)}`,
      sequence: index,
      turnId: `turn_${String(index)}`,
    },
    meta: {
      at: new Date(index * 1000).toISOString(),
      id: `event_${String(index)}`,
    },
    type: "message.received",
  };
}

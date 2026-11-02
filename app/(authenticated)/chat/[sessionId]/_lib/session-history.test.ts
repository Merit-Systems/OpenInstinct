import { Client } from "eve/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLatestSessionHistory } from "./session-history";

const client = new Client({ baseUrl: "" });

describe("session history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a bounded tail and keeps only the latest four turns", async () => {
    const lines = Array.from({ length: 6 }, (_, index) =>
      turnLines(index)
    ).flat();
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(lines.map((line) => JSON.stringify(line)).join("\n"), {
          headers: {
            "x-eve-stream-tail-index": String(lines.length - 1),
            "x-eve-stream-version": "27",
          },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = await readLatestSessionHistory(
      client.sessions.attach("session/one")
    );

    const requested = new URL(
      fetchMock.mock.calls[0]?.[0] ?? "",
      "http://localhost"
    );
    expect(requested.pathname).toBe("/eve/v1/session/session%2Fone/stream");
    expect(requested.searchParams.get("startIndex")).toBe("-128");
    expect(history.startIndex).toBe(4);
    expect(history.endIndex).toBe(12);
    expect(
      history.events
        .filter((event) => event.type === "turn.started")
        .map((event) => event.scope?.turnId)
    ).toEqual(["turn_2", "turn_3", "turn_4", "turn_5"]);
  });

  it("rejects a stream response without a durable tail cursor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(() =>
        Promise.resolve(
          new Response("\n", { headers: { "x-eve-stream-version": "27" } })
        )
      )
    );

    await expect(
      readLatestSessionHistory(client.sessions.attach("missing-tail"))
    ).rejects.toThrow("x-eve-stream-tail-index");
  });
});

/** One message turn as stored v27 lines: the turn opens, then consumes its message. */
function turnLines(index: number) {
  const turnId = `turn_${String(index)}`;
  const deliveryId = `delivery_${String(index)}`;
  const at = new Date(index * 1000).toISOString();
  return [
    {
      at,
      facts: [
        { data: { deliveryId }, type: "delivery.admitted" },
        {
          data: { cause: { deliveryId }, follows: null, turnId },
          scope: { turnId },
          type: "turn.started",
        },
      ],
    },
    {
      at,
      facts: [
        {
          data: {
            deliveryId,
            parts: [{ kind: "text", text: `Message ${String(index)}` }],
            turnId,
          },
          scope: { turnId },
          type: "delivery.consumed",
        },
      ],
    },
  ];
}

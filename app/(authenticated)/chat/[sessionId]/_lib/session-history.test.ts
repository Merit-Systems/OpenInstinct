import type { Fact } from "eve/events";
import { Client, conversationOf } from "eve/client";
import { collectSubagentSessions } from "@app/_lib/subagent-sessions";
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

  it("retains a continued child's relationship outside the transcript page", async () => {
    const lines = Array.from({ length: 100 }, (_, index) =>
      turnLines(index)
    ).flat();
    lines[1]?.facts.push({
      type: "child.opened",
      data: {
        name: "browser-agent",
        owner: { callId: "original-call" },
        sessionId: "child-1",
        stream: "/eve/v1/session/child-1/stream",
      },
      scope: { taskId: "task-1", turnId: "turn_0" },
    });
    lines[199]?.facts.push(
      {
        type: "model.requested",
        data: { runId: "run-99", owner: { turnId: "turn_99" } },
        scope: { runId: "run-99", turnId: "turn_99" },
      },
      {
        type: "call.requested",
        data: {
          callId: "continued-call",
          capability: { kind: "tool", name: "run_browser" },
          input: { message: "Task: Continue checkout" },
          owner: { runId: "run-99" },
        },
        scope: { runId: "run-99", turnId: "turn_99" },
      },
      {
        type: "call.started",
        data: { callId: "continued-call", taskId: "task-1" },
        scope: { runId: "run-99", taskId: "task-1", turnId: "turn_99" },
      },
      {
        type: "child.sent",
        data: {
          callId: "continued-call",
          childDeliveryId: "child-delivery-2",
          sessionId: "child-1",
        },
        scope: { taskId: "task-1", turnId: "turn_99" },
      }
    );
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>(
      (input) => {
        const cursor = Number(
          new URL(input, "http://localhost").searchParams.get("startIndex")
        );
        const start = cursor < 0 ? Math.max(0, lines.length + cursor) : cursor;
        return Promise.resolve(
          new Response(
            lines
              .slice(start)
              .map((line) => JSON.stringify(line))
              .join("\n"),
            {
              headers: {
                "x-eve-stream-tail-index": String(lines.length - 1),
                "x-eve-stream-version": "27",
              },
            }
          )
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const history = await readLatestSessionHistory(
      client.sessions.attach("parent-1")
    );
    expect(history.startIndex).toBe(192);
    expect(history.events.some((event) => event.type === "child.opened")).toBe(
      false
    );
    expect(history.childOpenings).toHaveLength(1);
    const sessions = collectSubagentSessions(
      history.events,
      conversationOf(history.events).view,
      history.childOpenings
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      childSessionId: "child-1",
      callId: "continued-call",
      task: "Continue checkout",
    });
    // Keep the authentic opening position for the parent's authorized child reader.
    expect(sessions[0]?.opened.meta.position.line).toBe(1);
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
  const lines: { at: string; facts: Fact[] }[] = [
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
  return lines;
}

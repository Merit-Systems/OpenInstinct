import { describe, expect, it } from "vitest";
import {
  historyReceivedMessage,
  historyToolResult,
} from "@tests/fixtures/message-history";
import { conversationRows } from "./conversation-rows";

describe("delivered conversation rows", () => {
  it("projects a replayed delivery call once", () => {
    const first = historyToolResult("turn-1", "first", "send_message", {
      kind: "message",
      text: "Accepted once",
    });
    const replay = { ...first, meta: { ...first.meta, id: "replayed-result" } };
    expect(conversationRows([], [first, replay], "imessage")).toHaveLength(1);
  });
  it("renders a contact introduction and downloadable attachment", () => {
    const rows = conversationRows(
      [],
      [
        historyToolResult("turn-1", "contact", "share_contact", {
          kind: "message",
          text: "Save my contact.",
          attachments: [
            {
              kind: "file",
              mimeType: "text/vcard",
              name: "OpenInstinct.vcf",
              url: "https://example.com/contact.vcf",
            },
          ],
        }),
      ],
      "imessage"
    );
    expect(rows[0]?.parts).toEqual([
      { type: "text", text: "Save my contact.", state: "done" },
      {
        type: "file",
        filename: "OpenInstinct.vcf",
        mediaType: "text/vcard",
        url: "https://example.com/contact.vcf",
      },
    ]);
    expect(
      conversationRows(
        [],
        [historyToolResult("turn-1", "contact", "share_contact", null)],
        "imessage"
      )
    ).toEqual([]);
  });

  it("preserves plain line breaks, native links, and separate sends in one turn", () => {
    const rows = conversationRows(
      [],
      [
        historyToolResult("turn-1", "first", "send_message", {
          kind: "message",
          text: "line one\nline two",
        }),
        historyToolResult("turn-1", "second", "send_message", {
          kind: "link",
          url: "https://example.com/article",
        }),
      ],
      "imessage"
    );
    expect(rows.map((row) => row.id)).toEqual(["tool:first", "tool:second"]);
    expect(rows[0]?.parts[0]).toMatchObject({ text: "line one  \nline two" });
    expect(rows[1]?.parts[0]).toMatchObject({
      text: "https://example.com/article",
    });
    expect(rows[0]?.timestamp).toBe("2026-10-05T20:00:30.000Z");
  });

  it.each(["failed", "rejected"] as const)("omits %s sends", (status) => {
    expect(
      conversationRows(
        [],
        [
          historyToolResult(
            "turn-1",
            "first",
            "send_message",
            { kind: "message", text: "Not delivered" },
            status
          ),
        ],
        "imessage"
      )
    ).toEqual([]);
  });

  it("shows messages even before an assistant reducer shell exists", () => {
    const rows = conversationRows(
      [],
      [
        historyToolResult("turn-1", "first", "send_message", {
          kind: "message",
          text: "Accepted by the provider",
        }),
      ],
      "imessage"
    );
    expect(rows[0]?.parts[0]).toMatchObject({
      text: "Accepted by the provider",
    });
  });

  it("keeps overlapping input and send ordering from the durable event stream", () => {
    const rows = conversationRows(
      [],
      [
        historyReceivedMessage("same-turn", [
          { type: "text", text: "First input" },
        ]),
        historyToolResult("same-turn", "first", "send_message", {
          kind: "message",
          text: "First answer",
        }),
        {
          ...historyReceivedMessage("same-turn", [
            { type: "text", text: "Steering input" },
          ]),
          meta: { id: "steered", at: "2026-10-05T20:00:30.000Z" },
        },
        historyToolResult("same-turn", "second", "send_message", {
          kind: "message",
          text: "Second answer",
        }),
      ],
      "imessage"
    );
    expect(
      rows.flatMap((row) =>
        row.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
      )
    ).toEqual([
      "First input",
      "First answer",
      "Steering input",
      "Second answer",
    ]);
  });

  it("does not project an unknown-target reaction as a message", () => {
    expect(
      conversationRows(
        [],
        [
          historyToolResult("turn-1", "reaction", "react_to_message", {
            messageId: "not-in-history",
            emoji: "👀",
            operation: "add",
          }),
        ],
        "imessage"
      )
    ).toEqual([]);
  });
});

import type { EveMessage } from "eve/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentMessage } from ".";
import type { ConversationRow } from "../../../_lib/conversation-rows";

describe("conversation row rendering", () => {
  it("renders ordinary trace text supplied by Eve", () => {
    const message = {
      id: "assistant-message",
      metadata: { status: "complete" },
      parts: [
        {
          state: "done",
          text: "Hello from ordinary assistant output.",
          type: "text",
        },
      ],
      role: "assistant",
    } satisfies EveMessage;
    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
      />
    );
    expect(markup).toContain("Hello from ordinary assistant output.");
  });

  it("renders the projected reply, reaction, and timestamp without a second content override", () => {
    const message = {
      id: "receipt:user",
      metadata: { status: "complete" },
      parts: [{ type: "text", text: "Here is the reply.", state: "done" }],
      role: "user",
      timestamp: "2026-10-05T20:00:00.000Z",
      reactions: ["👍"],
      reply: { targetId: "older:user", text: "Original request" },
    } satisfies ConversationRow;
    const markup = renderToStaticMarkup(
      <AgentMessage
        canRespond
        isStreaming={false}
        message={message}
        onInputResponses={() => undefined}
        userVisibleOnly
      />
    );
    expect(markup).toContain("Here is the reply.");
    expect(markup).toContain('href="#older%3Auser"');
    expect(markup).toContain('aria-label="Reaction 👍"');
    expect(markup).toContain('dateTime="2026-10-05T20:00:00.000Z"');
  });
});

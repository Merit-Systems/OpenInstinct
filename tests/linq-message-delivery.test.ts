/* oxlint-disable typescript/no-unsafe-type-assertion -- Eve's Linq adapter exposes the handler context through a transitive Chat SDK `any`; the fixture supplies only the fields exercised here. */
import { describe, expect, it, vi } from "vitest";
import {
  deliverCompletedLinqMessage,
  deliverLinqReaction,
} from "../agent/channels/linq";

type HandlerParameters = Parameters<typeof deliverCompletedLinqMessage>;

describe("Linq message delivery", () => {
  it("posts final responses as native iMessage Markdown", async () => {
    const message = [
      "Still blocked. No order was submitted.",
      "The order remains unchanged:",
      "Spider-Man: Brand New Day",
      "$15.00 total",
    ].join("\n");
    const { context, post } = handlerContext();

    await deliverCompletedLinqMessage(
      completedEvent({ message }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({ markdown: message });
  });

  it("suppresses intermediate tool-call messages without reacting automatically", async () => {
    const { addReaction, context, post, state } = handlerContext();

    await deliverCompletedLinqMessage(
      completedEvent({
        finishReason: "tool-calls",
        message: "Checking the checkout\nwith the browser",
      }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
    expect(addReaction).not.toHaveBeenCalled();
    expect(state.pendingToolCallMessage).toBe("Checking the checkout");
  });

  it("does not post an empty final response", async () => {
    const { context, post } = handlerContext();

    await deliverCompletedLinqMessage(
      completedEvent({ message: null }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
  });

  it("applies a reaction only when the model calls react_to_message", async () => {
    const { addReaction, context } = handlerContext();

    await deliverLinqReaction(
      {
        result: {
          callId: "call-1",
          kind: "tool-result",
          output: { reaction: "laugh" },
          toolName: "react_to_message",
        },
        sequence: 0,
        status: "completed",
        stepIndex: 0,
        turnId: "turn-1",
      },
      context,
      sessionContext()
    );

    expect(addReaction).toHaveBeenCalledExactlyOnceWith(
      "linq:dm:chat-1",
      "message-1",
      "laugh"
    );
  });
});

function completedEvent(
  overrides: Partial<HandlerParameters[0]> = {}
): HandlerParameters[0] {
  return {
    finishReason: "stop",
    message: "Done",
    sequence: 0,
    stepIndex: 0,
    turnId: "turn-1",
    ...overrides,
  };
}

function handlerContext() {
  const post = vi.fn<(message: string) => Promise<void>>();
  post.mockResolvedValue();
  const addReaction = vi
    .fn<(threadId: string, messageId: string, emoji: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const state: Record<string, unknown> = {};
  const context = {
    bot: {
      getAdapter: () => ({
        addReaction,
        decodeThreadId: () => ({ chatId: "chat-1", isGroup: false }),
      }),
    },
    state,
    thread: {
      id: "linq:dm:chat-1",
      post,
      toJSON: () => ({
        _type: "chat:Thread",
        adapterName: "linq",
        channelId: "linq:dm:chat-1",
        currentMessage: { id: "message-1" },
        id: "linq:dm:chat-1",
        isDM: true,
      }),
    },
  } as unknown as HandlerParameters[1];

  return { addReaction, context, post, state };
}

function sessionContext() {
  return {} as HandlerParameters[2];
}

/* oxlint-disable typescript/no-unsafe-type-assertion -- Eve's Linq adapter exposes the handler context through a transitive Chat SDK `any`; the fixture supplies only the fields exercised here. */
import { describe, expect, it, vi } from "vitest";
import { deliverCompletedLinqMessage } from "../agent/channels/linq";

type HandlerParameters = Parameters<typeof deliverCompletedLinqMessage>;

describe("Linq message delivery", () => {
  it("posts final multiline responses as unchanged raw text", async () => {
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

    expect(post).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("suppresses intermediate tool-call messages", async () => {
    const { context, post, state } = handlerContext();

    await deliverCompletedLinqMessage(
      completedEvent({
        finishReason: "tool-calls",
        message: "Checking the checkout\nwith the browser",
      }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
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
  const state: Record<string, unknown> = {};
  const context = {
    state,
    thread: { post },
  } as unknown as HandlerParameters[1];

  return { context, post, state };
}

function sessionContext() {
  return {} as HandlerParameters[2];
}

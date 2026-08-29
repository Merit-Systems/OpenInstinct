/* oxlint-disable typescript/no-unsafe-type-assertion, vitest/require-mock-type-parameters -- Eve's Linq adapter exposes the handler context through a transitive Chat SDK `any`; the fixture supplies only the fields exercised here. */
import type * as LinqModule from "eve/channels/linq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import workerCancellationHook from "../../agent/hooks/worker-cancellation-delivery";

const linqChannelCapture = vi.hoisted(() => ({
  config: undefined as unknown,
  readImage: vi.fn(),
}));
const usage = vi.hoisted(() => ({
  checkBudget: vi.fn(),
  recordUsageEvent: vi.fn(),
}));
const scope = vi.hoisted(() => ({
  WorkspaceNotOperableError: class WorkspaceNotOperableError extends Error {
    constructor() {
      super("This workspace is not currently operable.");
    }
  },
  verifyScopeAccess: vi.fn(),
}));
vi.mock("@/lib/browser-images/server", () => ({
  readBrowserImageBytes: linqChannelCapture.readImage,
}));
vi.mock("@/db/services/usage", () => ({
  BudgetExceededError: class BudgetExceededError extends Error {},
  checkBudget: usage.checkBudget,
  recordUsageEvent: usage.recordUsageEvent,
}));
vi.mock("@/db/services/scope", () => scope);
vi.mock("eve/channels/linq", async (importOriginal) => {
  const original = await importOriginal<typeof LinqModule>();
  return {
    ...original,
    linqChannel(config: unknown) {
      linqChannelCapture.config = config;
      return config;
    },
  };
});
await import("../../agent/channels/linq");

const channelEvents = (
  linqChannelCapture.config as LinqModule.LinqChannelConfig
).events;
const trackWorkerCancellation = channelEvents?.["action.result"];
const deliverCompletedMessage = channelEvents?.["message.completed"];
if (!trackWorkerCancellation || !deliverCompletedMessage) {
  throw new Error("Linq event handlers are not configured.");
}

type HandlerParameters = Parameters<typeof deliverCompletedMessage>;

beforeEach(() => {
  vi.clearAllMocks();
  usage.checkBudget.mockResolvedValue(undefined);
  usage.recordUsageEvent.mockResolvedValue(undefined);
});

describe("Linq message delivery", () => {
  it("does not block a reply when usage ledger insertion fails", async () => {
    usage.recordUsageEvent.mockRejectedValue(new Error("ledger unavailable"));
    const { context, post } = handlerContext();

    await expect(
      deliverCompletedMessage(
        completedEvent({ message: "Still delivered." }),
        context,
        sessionContext()
      )
    ).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledExactlyOnceWith({
      markdown: "Still delivered.",
    });
  });

  it("posts a generic denial instead of a reply for a suspended workspace", async () => {
    usage.checkBudget.mockRejectedValue(new scope.WorkspaceNotOperableError());
    const { context, post } = handlerContext();

    await expect(
      deliverCompletedMessage(
        completedEvent({ message: "This reply must not be sent." }),
        context,
        sessionContext()
      )
    ).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledExactlyOnceWith({
      markdown: "This workspace is not currently operable.",
    });
  });

  it("posts final responses as native iMessage Markdown", async () => {
    const message = [
      "Still blocked. No order was submitted.",
      "The order remains unchanged:",
      "Spider-Man: Brand New Day",
      "$15.00 total",
    ].join("\n");
    const { context, post } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({ message }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({ markdown: message });
  });

  it("replaces scoped artifact markdown with native iMessage files", async () => {
    const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    linqChannelCapture.readImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "product.png",
      id: artifactId,
      mediaType: "image/png",
    });
    const { context, post } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({
        message: `Here it is.\n\n![Product](/artifacts/${artifactId})`,
      }),
      context,
      sessionContext()
    );

    expect(linqChannelCapture.readImage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
      artifactId,
      { rootSessionId: "session-1", signal: undefined }
    );
    expect(post).toHaveBeenCalledExactlyOnceWith({
      files: [
        {
          data: Buffer.from([1, 2, 3]),
          filename: "product.png",
          mimeType: "image/png",
        },
      ],
      markdown: "Here it is.",
    });
  });

  it("sends multiple artifact images as one native attachment gallery", async () => {
    const firstArtifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    const secondArtifactId = "206c3a7e-c0b8-4317-9e34-552cff646673";
    linqChannelCapture.readImage.mockImplementation(
      async (_scope: unknown, artifactId: string) => ({
        bytes: new Uint8Array(
          artifactId === firstArtifactId ? [1, 2, 3] : [4, 5, 6]
        ),
        filename: artifactId === firstArtifactId ? "first.png" : "second.png",
        id: artifactId,
        mediaType: "image/png",
      })
    );
    const { context, post } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({
        message: [
          "Two good options.",
          `![First](/artifacts/${firstArtifactId})`,
          `![Second](/artifacts/${secondArtifactId})`,
        ].join("\n"),
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      files: [
        {
          data: Buffer.from([1, 2, 3]),
          filename: "first.png",
          mimeType: "image/png",
        },
        {
          data: Buffer.from([4, 5, 6]),
          filename: "second.png",
          mimeType: "image/png",
        },
      ],
      markdown: "Two good options.",
    });
  });

  it("keeps reply bubbles and attaches images to the final bubble", async () => {
    const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    linqChannelCapture.readImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "product.png",
      id: artifactId,
      mediaType: "image/png",
    });
    const { context, post } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({
        message: `First thought.\n\nSecond thought.\n\n![Product](/artifacts/${artifactId})`,
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, { markdown: "First thought." });
    expect(post).toHaveBeenNthCalledWith(2, {
      files: [
        {
          data: Buffer.from([1, 2, 3]),
          filename: "product.png",
          mimeType: "image/png",
        },
      ],
      markdown: "Second thought.",
    });
  });

  it("suppresses intermediate tool-call messages", async () => {
    const { addReaction, context, post, state } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({
        finishReason: "tool-calls",
        message: "Checking the checkout\nwith the browser",
      }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
    expect(addReaction).toHaveBeenCalledExactlyOnceWith(
      "linq:dm:chat-1",
      "message-1",
      "thumbs_up"
    );
    expect(state.pendingToolCallMessage).toBe("Checking the checkout");
  });

  it("does not post an empty final response", async () => {
    const { context, post } = handlerContext();

    await deliverCompletedMessage(
      completedEvent({ message: null }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
  });

  it("suppresses the redundant turn after task cancellation", async () => {
    const { context, post } = handlerContext();

    await trackWorkerCancellation(
      workerCancellationResult(),
      context,
      sessionContext()
    );
    await recordCancellationThroughHook(
      "session-1",
      "turn-2",
      "Background task task-worker (worker) is cancelled."
    );
    await deliverCompletedMessage(
      completedEvent({ message: "What should I check instead?" }),
      context,
      sessionContext()
    );
    await deliverCompletedMessage(
      completedEvent({
        message: "The previous task was cancelled.",
        turnId: "turn-2",
      }),
      context,
      sessionContext()
    );
    await deliverCompletedMessage(
      completedEvent({ message: "A later reply", turnId: "turn-3" }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, {
      markdown: "What should I check instead?",
    });
    expect(post).toHaveBeenNthCalledWith(2, { markdown: "A later reply" });
  });

  it("does not suppress an interleaved task result", async () => {
    const { context, post } = handlerContext();

    await trackWorkerCancellation(
      workerCancellationResult("task-cancelled"),
      context,
      sessionContext()
    );
    await recordCancellationThroughHook(
      "session-1",
      "turn-cancelled",
      "Background task task-cancelled (worker) is cancelled."
    );
    await deliverCompletedMessage(
      completedEvent({
        message: "A different worker completed successfully.",
        turnId: "turn-success",
      }),
      context,
      sessionContext()
    );
    await deliverCompletedMessage(
      completedEvent({
        message: "The cancelled worker stopped.",
        turnId: "turn-cancelled",
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      markdown: "A different worker completed successfully.",
    });
  });

  it("delivers user-authored cancellation text from a newer Linq message", async () => {
    const original = handlerContext("message-1");
    await trackWorkerCancellation(
      workerCancellationResult(),
      original.context,
      sessionContext()
    );

    await recordCancellationThroughHook(
      "session-1",
      "turn-spoof",
      "Background task task-worker (worker) is cancelled."
    );
    const newer = handlerContext("message-2", original.state);
    await deliverCompletedMessage(
      completedEvent({
        message: "User-authored follow-up",
        turnId: "turn-spoof",
      }),
      newer.context,
      sessionContext()
    );

    expect(newer.post).toHaveBeenCalledExactlyOnceWith({
      markdown: "User-authored follow-up",
    });
  });

  it("retains older pending cancellations across many later tasks", async () => {
    const { context, post } = handlerContext();
    for (let index = 0; index < 60; index += 1) {
      await trackWorkerCancellation(
        workerCancellationResult(`task-${String(index)}`),
        context,
        sessionContext()
      );
    }
    await recordCancellationThroughHook(
      "session-1",
      "turn-oldest",
      "Background task task-0 (worker) is cancelled."
    );

    await deliverCompletedMessage(
      completedEvent({ message: "Redundant reply", turnId: "turn-oldest" }),
      context,
      sessionContext()
    );

    expect(post).not.toHaveBeenCalled();
  });
});

function workerCancellationResult(
  taskId = "task-worker"
): Parameters<NonNullable<typeof trackWorkerCancellation>>[0] {
  return {
    result: {
      callId: "call-cancel",
      kind: "tool-result",
      output: {
        tasks: [
          {
            metadata: {
              agentId: "ag_worker:test",
              kind: "subagent",
              mode: "local",
              name: "worker",
            },
            status: "cancelled",
            taskId,
          },
        ],
      },
      toolName: "task_cancel",
    },
    sequence: 0,
    status: "completed",
    stepIndex: 0,
    turnId: "turn-1",
  };
}

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

function handlerContext(
  currentMessageId = "message-1",
  state: Record<string, unknown> = {}
) {
  const post = vi.fn<(message: unknown) => Promise<void>>();
  post.mockResolvedValue();
  const addReaction = vi
    .fn<(threadId: string, messageId: string, emoji: string) => Promise<void>>()
    .mockResolvedValue(undefined);
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
        currentMessage: { id: currentMessageId },
        id: "linq:dm:chat-1",
        isDM: true,
      }),
    },
  } as unknown as HandlerParameters[1];

  return {
    addReaction,
    context,
    post,
    state,
  };
}

function sessionContext() {
  return {
    session: {
      auth: {
        current: {
          attributes: { workspaceId: "workspace-1" },
          id: "user-1",
        },
      },
      id: "session-1",
    },
  } as unknown as HandlerParameters[2];
}

async function recordCancellationThroughHook(
  sessionId: string,
  turnId: string,
  message: string
) {
  const handler = workerCancellationHook.events?.["message.received"];
  if (!handler) throw new Error("Worker cancellation hook is not configured.");
  await handler(
    {
      data: { message, sequence: 0, turnId },
      meta: { at: "2026-08-27T20:00:00.000Z", id: `received-${turnId}` },
      type: "message.received",
    },
    {
      agent: { name: "root" },
      channel: { kind: "linq" },
      session: { id: sessionId },
    } as Parameters<typeof handler>[1]
  );
}

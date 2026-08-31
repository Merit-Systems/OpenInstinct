/* oxlint-disable typescript/no-unsafe-type-assertion -- The handler fixture supplies only the Chat SDK fields exercised here. */
import type { HookContext } from "eve/hooks";
import { describe, expect, it, vi } from "vitest";
import type * as Blob from "@vercel/blob";
import type { AccessScope } from "@/lib/access-scope";
import workerCancellationHook from "@/agent/hooks/worker-cancellation-delivery";
import { linqChannelConfig } from "@/agent/channels/linq";

interface BrowserImage {
  bytes: Uint8Array;
  filename: string;
  id: string;
  mediaType: string;
}

const linqChannelCapture = vi.hoisted(() => ({
  images: new Map<string, BrowserImage>(),
  readImage: vi.fn<
    (
      scope: AccessScope,
      id: string,
      options: {
        readonly rootSessionId: string;
        readonly signal?: AbortSignal;
      }
    ) => Promise<BrowserImage | undefined>
  >(),
}));
vi.mock("@/db/services/browser-images", () => ({
  async readReadyBrowserImageArtifact(
    scope: AccessScope,
    id: string,
    options: { readonly rootSessionId: string; readonly signal?: AbortSignal }
  ) {
    const image = await linqChannelCapture.readImage(scope, id, options);
    if (!image) return undefined;
    linqChannelCapture.images.set(id, image);
    return {
      byteSize: image.bytes.byteLength,
      contentHash:
        image.bytes[0] === 1
          ? "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
          : "787c798e39a5bc1910355bae6d0cd87a36b2e10fd0202a83e3bb6b005da83472",
      filename: image.filename,
      id,
      mediaType: image.mediaType,
      storagePathname: id,
    };
  },
}));
vi.mock("@vercel/blob", async (importOriginal) => {
  const blob = await importOriginal<typeof Blob>();
  return {
    ...blob,
    async get(pathname: string) {
      const image = linqChannelCapture.images.get(pathname);
      if (!image) return null;
      return {
        blob: { contentType: image.mediaType, size: image.bytes.byteLength },
        statusCode: 200,
        stream: new Response(Buffer.from(image.bytes)).body,
      };
    },
  };
});
const channelEvents = linqChannelConfig.events;
const trackWorkerCancellation = channelEvents["action.result"];
const deliverCompletedMessage = channelEvents["message.completed"];

type HandlerParameters = Parameters<typeof deliverCompletedMessage>;

interface LinqTestMessage {
  readonly files?: readonly {
    readonly data: Buffer;
    readonly filename: string;
    readonly mimeType: string;
  }[];
  readonly markdown: string;
}

interface LinqTestState {
  acknowledgedLinqMessageId?: string;
  pendingToolCallMessage?: string | null;
  workerCancellations?: readonly {
    readonly sourceMessageId: string;
    readonly taskId: string;
  }[];
}

describe("Linq message delivery", () => {
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
      async (_scope, artifactId) => ({
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

    trackWorkerCancellation(workerCancellationResult(), context);
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

    trackWorkerCancellation(
      workerCancellationResult("task-cancelled"),
      context
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
    trackWorkerCancellation(workerCancellationResult(), original.context);

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
      trackWorkerCancellation(
        workerCancellationResult(`task-${String(index)}`),
        context
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
  state: LinqTestState = {}
) {
  const post = vi.fn<(message: LinqTestMessage) => Promise<void>>();
  post.mockResolvedValue();
  const addReaction = vi
    .fn<(threadId: string, messageId: string, emoji: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  // SAFETY: The fixture implements the Linq handler fields exercised by these tests.
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
  } as HandlerParameters[1];

  return {
    addReaction,
    context,
    post,
    state,
  };
}

function sessionContext() {
  return {
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    session: {
      auth: {
        current: {
          attributes: { workspaceId: "workspace-1" },
          authenticator: "test",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
  } satisfies HandlerParameters[2];
}

async function recordCancellationThroughHook(
  sessionId: string,
  turnId: string,
  message: string
) {
  const handler = workerCancellationHook.events?.["message.received"];
  if (!handler) throw new Error("Worker cancellation hook is not configured.");
  const context = {
    agent: { name: "root" },
    channel: { kind: "linq" },
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    session: {
      auth: { current: null, initiator: null },
      id: sessionId,
      turn: { id: turnId, sequence: 0 },
    },
  } satisfies HookContext;
  await handler(
    {
      data: { message, sequence: 0, turnId },
      meta: { at: "2026-08-27T20:00:00.000Z", id: `received-${turnId}` },
      type: "message.received",
    },
    context
  );
}

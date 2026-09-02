import type { LinqChannelConfig } from "eve/channels/linq";
import type { LinqSendOptions } from "@linqapp/chat-sdk-adapter";
import type { LinqAPIV3 } from "@linqapp/sdk";
import type { AdapterPostableMessage } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Blob from "@vercel/blob";
import type * as EnvModule from "@/env";
import { sendMessageOutputSchema } from "@/agent/lib/send-message";
import type { AccessScope } from "@/lib/access-scope";
import type {
  finalizeScheduledReport,
  releaseScheduledReport,
} from "@/db/services/scheduled-agent-jobs";
// oxlint-disable-next-line import/no-unassigned-import -- Loads the production module so the mocked channel factory can capture its configuration.
import "@/agent/channels/linq";

interface BrowserImage {
  bytes: Uint8Array;
  filename: string;
  id: string;
  mediaType: string;
}

type NativeMessageBody = Parameters<LinqAPIV3["chats"]["messages"]["send"]>[1];
type NativeMessageOptions = Parameters<
  LinqAPIV3["chats"]["messages"]["send"]
>[2];

const linqChannelCapture = vi.hoisted(() => ({
  artifacts: new Map<
    string,
    {
      description?: string;
      id: string;
      kind: "html" | "image";
      sourceUrl?: string;
      title: string;
    }
  >(),
  // SAFETY: This mutable test capture stores only API keys from the typed SDK constructor mock.
  clientApiKeys: [] as string[],
  // SAFETY: The mocked channel factory replaces this value during module loading.
  config: undefined as LinqChannelConfig | undefined,
  images: new Map<string, BrowserImage>(),
  failedPublications: new Set<string>(),
  publishedArtifactIds: Array<string>(),
  publicationSignals: Array<AbortSignal | undefined>(),
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
  postMessage: vi
    .fn<
      (
        threadId: string,
        message: AdapterPostableMessage,
        options?: LinqSendOptions
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined),
  resolveApiKey: vi
    .fn<() => Promise<string>>()
    .mockResolvedValue("linq-test-api-key"),
  sendNativeMessage: vi
    .fn<
      (
        chatId: string,
        body: NativeMessageBody,
        options?: NativeMessageOptions
      ) => Promise<void>
    >()
    .mockResolvedValue(undefined),
}));
const scheduleDeliveryCapture = vi.hoisted(() => ({
  finalize: vi.fn<typeof finalizeScheduledReport>(),
  release: vi.fn<typeof releaseScheduledReport>(),
}));
vi.mock("@/db/services/scheduled-agent-jobs", () => ({
  finalizeScheduledReport: scheduleDeliveryCapture.finalize,
  releaseScheduledReport: scheduleDeliveryCapture.release,
}));
vi.mock("@/env", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return {
    ...original,
    env: { ...original.env, LINQ_CONNECTOR: "linq/test" },
  };
});
vi.mock("@vercel/connect/eve", () => ({
  connectLinqCredentials: () => ({
    apiKey: linqChannelCapture.resolveApiKey,
  }),
}));
vi.mock("@linqapp/sdk", () => ({
  LinqAPIV3: class {
    constructor(options: Pick<LinqAPIV3, "apiKey">) {
      linqChannelCapture.clientApiKeys.push(options.apiKey);
    }

    chats = {
      messages: { send: linqChannelCapture.sendNativeMessage },
    };
  },
}));
vi.mock(import("eve/channels/linq"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    linqChannel(config: LinqChannelConfig) {
      linqChannelCapture.config = config;
      return original.linqChannel(config);
    },
  };
});
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
vi.mock("@/lib/application-origin", () => ({
  applicationOrigin: () => "https://openinstinct.example",
}));
vi.mock("@/lib/artifacts/server", () => ({
  async publishArtifactForSharing(
    _scope: AccessScope,
    id: string,
    signal?: AbortSignal
  ) {
    linqChannelCapture.publishedArtifactIds.push(id);
    linqChannelCapture.publicationSignals.push(signal);
    if (linqChannelCapture.failedPublications.has(id)) {
      throw new Error("Blob write failed");
    }
    return linqChannelCapture.artifacts.get(id);
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
const handleActionResult = linqChannelCapture.config?.events?.["action.result"];
if (!handleActionResult) {
  throw new Error("The Linq channel must configure action result delivery.");
}

type ActionHandlerParameters = Parameters<typeof handleActionResult>;

interface LinqTestMessage {
  readonly attachments?: readonly {
    readonly mimeType?: string;
    readonly name?: string;
    readonly type: "audio" | "file" | "image" | "video";
    readonly url: string;
  }[];
  readonly files?: readonly {
    readonly data: Buffer;
    readonly filename: string;
    readonly mimeType: string;
  }[];
  readonly text: string;
}

describe("Linq message delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linqChannelCapture.artifacts.clear();
    linqChannelCapture.failedPublications.clear();
    linqChannelCapture.publishedArtifactIds.length = 0;
    linqChannelCapture.publicationSignals.length = 0;
    scheduleDeliveryCapture.finalize.mockResolvedValue(true);
    scheduleDeliveryCapture.release.mockResolvedValue(true);
  });

  it("does not register automatic assistant text posting", () => {
    expect(linqChannelCapture.config?.events?.["message.completed"]).toBeTypeOf(
      "function"
    );
  });

  it("posts send_message output as raw iMessage text", async () => {
    const message = [
      "Still blocked. No order was submitted.",
      "The order remains unchanged:",
      "Spider-Man: Brand New Day",
      "$15.00 total",
    ].join("\n");
    const { context, post } = handlerContext();

    await handleActionResult(
      sendMessageResult({ kind: "message", text: message }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({ raw: message });
  });

  it("finalizes a scheduled result after send_message posts it", async () => {
    const { context } = handlerContext();

    await handleActionResult(
      sendMessageResult({ kind: "message", text: "The price fell." }),
      context,
      sessionContext("scheduled-result")
    );

    expect(scheduleDeliveryCapture.finalize).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000004",
      "delivered"
    );
    expect(linqChannelCapture.postMessage).toHaveBeenCalledExactlyOnceWith(
      "linq:dm:chat-1",
      { raw: "The price fell." },
      {
        idempotencyKey:
          "scheduled-report:00000000-0000-4000-8000-000000000002:1",
      }
    );
  });

  it("uses the same Linq idempotency key when a report turn is retried", async () => {
    const { context } = handlerContext();
    const event = sendMessageResult({
      kind: "message",
      text: "The price fell.",
    });

    await handleActionResult(
      event,
      context,
      sessionContext("scheduled-result")
    );
    await handleActionResult(
      event,
      context,
      sessionContext("scheduled-result")
    );

    expect(linqChannelCapture.postMessage).toHaveBeenCalledTimes(2);
    expect(linqChannelCapture.postMessage.mock.calls[0]?.[2]).toEqual(
      linqChannelCapture.postMessage.mock.calls[1]?.[2]
    );
  });

  it("posts one native rich link preview per call with fresh credentials", async () => {
    const { context, post } = handlerContext();
    linqChannelCapture.clientApiKeys.length = 0;
    linqChannelCapture.resolveApiKey
      .mockResolvedValueOnce("linq-api-key-1")
      .mockResolvedValueOnce("linq-api-key-2");

    await handleActionResult(
      sendMessageResult({ kind: "link", url: "https://example.com/first" }),
      context,
      sessionContext()
    );
    await handleActionResult(
      sendMessageResult({ kind: "link", url: "https://example.com/second" }),
      context,
      sessionContext()
    );

    expect(linqChannelCapture.resolveApiKey).toHaveBeenCalledTimes(2);
    expect(linqChannelCapture.clientApiKeys).toEqual([
      "linq-api-key-1",
      "linq-api-key-2",
    ]);
    expect(linqChannelCapture.sendNativeMessage).toHaveBeenNthCalledWith(
      1,
      "chat-1",
      {
        message: {
          parts: [{ type: "link", value: "https://example.com/first" }],
        },
      },
      undefined
    );
    expect(linqChannelCapture.sendNativeMessage).toHaveBeenNthCalledWith(
      2,
      "chat-1",
      {
        message: {
          parts: [{ type: "link", value: "https://example.com/second" }],
        },
      },
      undefined
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("requires a native link preview to be its own send_message call", () => {
    expect(
      sendMessageOutputSchema.safeParse({
        kind: "link",
        text: "Read this",
        url: "https://example.com/article",
      }).success
    ).toBe(false);
  });

  it("discriminates native links from message content", () => {
    expect(
      sendMessageOutputSchema.safeParse({
        attachments: [{ kind: "image", url: "https://example.com/image.png" }],
        kind: "message",
        text: "A caption",
      }).success
    ).toBe(true);
    expect(sendMessageOutputSchema.safeParse({ kind: "message" }).success).toBe(
      false
    );
    expect(
      sendMessageOutputSchema.safeParse({
        kind: "message",
        text: "Read this",
        url: "https://example.com/article",
      }).success
    ).toBe(false);
    expect(
      sendMessageOutputSchema.safeParse({
        link: "https://example.com/article",
      }).success
    ).toBe(false);
  });

  it("enforces Linq's native link URL constraints", () => {
    const prefix = "https://example.com/";
    const maximumLengthLink = `${prefix}${"a".repeat(2048 - prefix.length)}`;

    expect(
      sendMessageOutputSchema.safeParse({
        kind: "link",
        url: maximumLengthLink,
      }).success
    ).toBe(true);
    expect(
      sendMessageOutputSchema.safeParse({
        kind: "link",
        url: `${maximumLengthLink}a`,
      }).success
    ).toBe(false);
    expect(
      sendMessageOutputSchema.safeParse({
        kind: "link",
        url: "http://example.com/article",
      }).success
    ).toBe(false);
  });

  it("posts a proactive message without a current inbound message", async () => {
    const { context, post } = handlerContext(undefined);

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: "Your weekly summary is ready.",
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      raw: "Your weekly summary is ready.",
    });
  });

  it.each([
    ["image", "image/jpeg", "photo.jpg"],
    ["video", "video/mp4", "clip.mp4"],
    ["audio", "audio/mpeg", "voice.mp3"],
    ["file", "application/pdf", "brief.pdf"],
  ] as const)("posts a native %s attachment", async (kind, mimeType, name) => {
    const { context, post } = handlerContext();
    const url = `https://media.example/${name}`;

    await handleActionResult(
      sendMessageResult({
        attachments: [{ kind, mimeType, name, url }],
        kind: "message",
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      attachments: [{ mimeType, name, type: kind, url }],
      raw: "",
    });
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

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `Here it is.\n\n![Product](/artifacts/${artifactId})`,
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
      raw: "Here it is.",
    });
  });

  it("replaces published image markers with a public URL and attachment", async () => {
    const artifactId = "206c3a7e-c0b8-4317-9e34-552cff646673";
    linqChannelCapture.artifacts.set(artifactId, {
      description: "A generated image",
      id: artifactId,
      kind: "image",
      sourceUrl: "https://images.example/result.png",
      title: "Result",
    });
    const { context, post } = handlerContext();

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `Here it is.\n\n[[artifact:${artifactId}]]`,
      }),
      context,
      sessionContext()
    );

    expect(linqChannelCapture.publishedArtifactIds).toEqual([artifactId]);
    expect(linqChannelCapture.publicationSignals[0]).toBeInstanceOf(
      AbortSignal
    );
    expect(post).toHaveBeenCalledExactlyOnceWith({
      attachments: [
        {
          name: "Result",
          type: "image",
          url: "https://images.example/result.png",
        },
      ],
      raw: `Here it is.\n\nhttps://openinstinct.example/artifacts/published/${artifactId}`,
    });
  });

  it("replaces published HTML markers with a public artifact URL", async () => {
    const artifactId = "206c3a7e-c0b8-4317-9e34-552cff646673";
    linqChannelCapture.artifacts.set(artifactId, {
      id: artifactId,
      kind: "html",
      title: "Research report",
    });
    const { context, post } = handlerContext();

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `Report ready.\n\n[[artifact:${artifactId}]]`,
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      raw: `Report ready.\n\nhttps://openinstinct.example/artifacts/published/${artifactId}`,
    });
  });

  it("does not send a broken URL when publication fails", async () => {
    const artifactId = "206c3a7e-c0b8-4317-9e34-552cff646673";
    linqChannelCapture.failedPublications.add(artifactId);
    const consoleWarn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const { context, post } = handlerContext();

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `Here it is.\n\n[[artifact:${artifactId}]]`,
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      raw: "Here it is.\n\nI couldn't publish one artifact.",
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[linq] artifact delivery failed",
      {
        artifactIds: [artifactId],
        sessionId: "session-1",
      }
    );
    consoleWarn.mockRestore();
  });

  it("loads scheduled artifacts from the scheduled-run session", async () => {
    const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    linqChannelCapture.readImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "scheduled-product.png",
      id: artifactId,
      mediaType: "image/png",
    });
    const { context } = handlerContext();

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `Price changed.\n\n![Product](/artifacts/${artifactId})`,
      }),
      context,
      sessionContext("scheduled-result")
    );

    expect(linqChannelCapture.readImage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
      artifactId,
      { rootSessionId: "scheduled-run-session", signal: undefined }
    );
    expect(linqChannelCapture.postMessage).toHaveBeenCalledWith(
      "linq:dm:chat-1",
      expect.objectContaining({
        files: [expect.objectContaining({ filename: "scheduled-product.png" })],
        raw: "Price changed.",
      }),
      expect.objectContaining({
        idempotencyKey:
          "scheduled-report:00000000-0000-4000-8000-000000000002:1",
      })
    );
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

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: [
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
      raw: "Two good options.",
    });
  });

  it("keeps one send_message call in one bubble with its images", async () => {
    const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
    linqChannelCapture.readImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "product.png",
      id: artifactId,
      mediaType: "image/png",
    });
    const { context, post } = handlerContext();

    await handleActionResult(
      sendMessageResult({
        kind: "message",
        text: `First thought.\n\nSecond thought.\n\n![Product](/artifacts/${artifactId})`,
      }),
      context,
      sessionContext()
    );

    expect(post).toHaveBeenCalledExactlyOnceWith({
      files: [
        {
          data: Buffer.from([1, 2, 3]),
          filename: "product.png",
          mimeType: "image/png",
        },
      ],
      raw: "First thought.\n\nSecond thought.",
    });
  });

  it.each([
    "thumbs_up",
    "thumbs_down",
    "heart",
    "laugh",
    "exclamation",
    "question",
  ] as const)("adds the native %s Tapback", async (type) => {
    const { addReaction, context, post } = handlerContext();

    await handleActionResult(
      reactToMessageResult({ operation: "add", type }),
      context,
      sessionContext()
    );

    expect(addReaction).toHaveBeenCalledExactlyOnceWith(
      "linq:dm:chat-1",
      "message-1",
      type
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("removes a native Tapback", async () => {
    const { context, post, removeReaction } = handlerContext();

    await handleActionResult(
      reactToMessageResult({ operation: "remove", type: "heart" }),
      context,
      sessionContext()
    );

    expect(removeReaction).toHaveBeenCalledExactlyOnceWith(
      "linq:dm:chat-1",
      "message-1",
      "heart"
    );
    expect(post).not.toHaveBeenCalled();
  });
});

function sendMessageResult(
  output: ActionHandlerParameters[0]["result"] extends { output: infer Output }
    ? Output
    : never
): ActionHandlerParameters[0] {
  return {
    result: {
      callId: "call-send-message",
      kind: "tool-result",
      output,
      toolName: "send_message",
    },
    sequence: 0,
    status: "completed",
    stepIndex: 0,
    turnId: "turn-1",
  };
}

function reactToMessageResult(
  output: ActionHandlerParameters[0]["result"] extends { output: infer Output }
    ? Output
    : never
): ActionHandlerParameters[0] {
  return {
    result: {
      callId: "call-react-to-message",
      kind: "tool-result",
      output,
      toolName: "react_to_message",
    },
    sequence: 0,
    status: "completed",
    stepIndex: 0,
    turnId: "turn-1",
  };
}

function handlerContext(currentMessageId: string | undefined = "message-1") {
  const post = vi.fn<(message: LinqTestMessage) => Promise<void>>();
  post.mockResolvedValue();
  const addReaction = vi
    .fn<(threadId: string, messageId: string, emoji: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const removeReaction = vi
    .fn<(threadId: string, messageId: string, emoji: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const context = handlerEventContext({
    bot: {
      getAdapter: () => ({
        addReaction,
        decodeThreadId: () => ({ chatId: "chat-1", isGroup: false }),
        postMessage: linqChannelCapture.postMessage,
        removeReaction,
      }),
    },
    state: {},
    streaming: false,
    streamingEditIntervalMs: 1000,
    thread: {
      id: "linq:dm:chat-1",
      post,
      toJSON: () => ({
        _type: "chat:Thread",
        adapterName: "linq",
        channelId: "linq:dm:chat-1",
        currentMessage: currentMessageId ? { id: currentMessageId } : undefined,
        id: "linq:dm:chat-1",
        isDM: true,
      }),
    },
  });

  return {
    addReaction,
    context,
    post,
    removeReaction,
  };
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This test adapter deliberately accepts a focused structural fixture.
function handlerEventContext(value: unknown): ActionHandlerParameters[1] {
  // SAFETY: Callers provide every Linq context field exercised by these focused handlers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- A complete Chat SDK bot mock would add 97 unrelated methods.
  return value as ActionHandlerParameters[1];
}

function sessionContext(authenticator = "test") {
  const attributes: Record<string, string | readonly string[]> =
    authenticator === "scheduled-result"
      ? {
          scheduledReportLeaseToken: "00000000-0000-4000-8000-000000000004",
          scheduledReportSequence: "1",
          scheduledRunId: "00000000-0000-4000-8000-000000000002",
          scheduledRunSessionId: "scheduled-run-session",
          workspaceId: "workspace-1",
        }
      : { workspaceId: "workspace-1" };
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
          attributes,
          authenticator,
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
  } satisfies ActionHandlerParameters[2];
}

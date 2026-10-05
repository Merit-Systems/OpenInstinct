import type * as ChatSdkModule from "eve/channels/chat-sdk";
import type {
  ChatSdkChannelConfig,
  ChatSdkChannelBridge,
} from "eve/channels/chat-sdk";
import type { createLinqAdapter } from "@linqapp/chat-sdk-adapter";
import { Message } from "chat";
import type { Thread } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@shared/environment";
import { linqWebhookVerifier } from "@agent/lib/linq/transport";

type LinqBridge = ChatSdkChannelBridge<{
  linq: ReturnType<typeof createLinqAdapter>;
}>;
const capture = vi.hoisted(() => ({
  // SAFETY: The actual bridge's handler registration supplies this callback.
  onMessage: undefined as
    | Parameters<LinqBridge["bot"]["onNewMessage"]>[1]
    | undefined,
  findOne:
    vi.fn<() => Promise<{ id: string; phoneNumberVerified: boolean } | null>>(),
  send: vi.fn<LinqBridge["send"]>(),
}));
vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return { ...original, env: { ...original.env, LINQ_CONNECTOR: "linq/test" } };
});
vi.mock("@vercel/connect/eve", () => ({
  connectLinqCredentials: () => ({ apiKey: async () => "linq-test-api-key" }),
}));
vi.mock("eve/channels/chat-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof ChatSdkModule>();
  return {
    ...original,
    chatSdkChannel(
      config: ChatSdkChannelConfig<{
        linq: ReturnType<typeof createLinqAdapter>;
      }>
    ) {
      const bridge = original.chatSdkChannel(config);
      vi.spyOn(bridge.bot, "onNewMessage").mockImplementation(
        (_pattern, handler) => {
          capture.onMessage = handler;
        }
      );
      vi.spyOn(config.adapters.linq, "markRead").mockResolvedValue(undefined);
      return { ...bridge, send: capture.send };
    },
  };
});
vi.mock("@db/services/auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({ adapter: { findOne: capture.findOne } }),
  }),
}));
// Load the channel after installing the bridge capture.
await import("@agent/channels/linq");
const onMessage = capture.onMessage;
if (!onMessage)
  throw new Error("The Linq bridge must register its inbound handler.");

describe("Linq inbound authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("rejects a webhook without a forwarder credential", async () => {
    const request = new Request("https://assistant.example/eve/v1/linq", {
      body: "{}",
      method: "POST",
    });
    await expect(linqWebhookVerifier(request, new Uint8Array())).resolves.toBe(
      false
    );
  });
  it("rejects a webhook with a malformed bearer token", async () => {
    const request = new Request("https://assistant.example/eve/v1/linq", {
      body: "{}",
      headers: { authorization: "Bearer aaa.bbb.ccc" },
      method: "POST",
    });
    await expect(linqWebhookVerifier(request, new Uint8Array())).resolves.toBe(
      false
    );
  });
  it("drops unlinked handles before dispatch", async () => {
    capture.findOne.mockResolvedValue(null);
    await onMessage(thread(), linqMessage("+15550100011"));
    expect(capture.send).not.toHaveBeenCalled();
    expect(capture.findOne).toHaveBeenCalledExactlyOnceWith({
      model: "user",
      where: [{ field: "phoneNumber", value: "+15550100011" }],
    });
  });
  it("drops handles whose user has not verified the phone", async () => {
    capture.findOne.mockResolvedValue({
      id: "user-1",
      phoneNumberVerified: false,
    });
    await onMessage(thread(), linqMessage("+15550100011"));
    expect(capture.send).not.toHaveBeenCalled();
  });
  it("scopes a verified handle and embeds annotations in the dispatched message", async () => {
    capture.findOne.mockResolvedValue({
      id: "user-1",
      phoneNumberVerified: true,
    });
    await onMessage(
      thread(),
      linqMessage("+15550100011", {
        parts: [{ type: "text", value: "list my vault items" }],
      })
    );
    expect(capture.send).toHaveBeenCalledOnce();
    const [content, options] = capture.send.mock.calls[0] ?? [];
    expect(content).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-1","sender":"user"}]\n[Parts: [{"partIndex":0,"type":"text","value":"list my vault items"}]]',
      },
      { type: "text", text: "list my vault items" },
    ]);
    expect(options?.auth?.principalId).toBe("better-auth:user-1");
    expect(options?.auth?.attributes).toMatchObject({
      conversationChannel: "linq",
      conversationId: "linq:chat-1",
      linqMessageId: "message-1",
      phoneNumber: "+15550100011",
    });
    expect(options?.auth?.attributes.workspaceId).toMatch(
      /^personal:[0-9a-f]{32}$/
    );
  });
  it("embeds the older quoted message and part index in the same content label", async () => {
    capture.findOne.mockResolvedValue({
      id: "user-1",
      phoneNumberVerified: true,
    });
    await onMessage(
      thread(),
      linqMessage("+15550100011", {
        reply_to: {
          message_id: "00000000-0000-4000-8000-000000000002",
          part_index: 2,
        },
      })
    );
    expect(capture.send.mock.calls[0]?.[0]).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-1","sender":"user"}]\n[Reply to: {"messageId":"00000000-0000-4000-8000-000000000002","partIndex":2}]',
      },
      { type: "text", text: "list my vault items" },
    ]);
  });
  it("keeps the body and current ID if raw references are malformed", async () => {
    capture.findOne.mockResolvedValue({
      id: "user-1",
      phoneNumberVerified: true,
    });
    await onMessage(
      thread(),
      linqMessage("+15550100011", { reply_to: { part_index: -1 } })
    );
    expect(capture.send.mock.calls[0]?.[0]).toEqual([
      {
        type: "text",
        text: '[Message: {"messageId":"message-1","sender":"user"}]',
      },
      { type: "text", text: "list my vault items" },
    ]);
  });
});

function thread(): Thread {
  // SAFETY: Inbound routing and the mocked send boundary read only this thread ID.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Constructing a complete SDK thread adds unrelated provider operations.
  return { id: "linq:chat-1" } as Thread;
}
function linqMessage(handle: string, raw: Message["raw"] = {}) {
  return new Message({
    attachments: [],
    author: {
      fullName: handle,
      isBot: false,
      isMe: false,
      userId: handle,
      userName: handle,
    },
    formatted: { children: [], type: "root" },
    id: "message-1",
    metadata: { dateSent: new Date("2026-09-03T00:00:00.000Z"), edited: false },
    raw,
    text: "list my vault items",
    threadId: "linq:chat-1",
  });
}

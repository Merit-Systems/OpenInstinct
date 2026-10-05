import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messaging from "@agent/tools/messaging";
import { reactToMessageInputSchema } from "@shared/chat/reaction";
import type * as EnvModule from "@shared/environment";

const controls = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  apiKey: vi.fn<() => Promise<string>>(),
  chatId: "chat-1",
}));
vi.mock("@vercel/connect/eve", () => ({
  connectLinqCredentials: () => ({ apiKey: controls.apiKey }),
}));
vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>();
  return { ...original, env: { ...original.env, LINQ_CONNECTOR: "linq/test" } };
});

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const third = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  controls.chatId = "chat-1";
  controls.apiKey.mockResolvedValue("linq-test-key");
  controls.fetch.mockReset().mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    return Response.json(
      request.url.endsWith("/reactions")
        ? { status: "accepted" }
        : { id: request.url.split("/").at(-1), chat_id: controls.chatId }
    );
  });
  vi.stubGlobal("fetch", controls.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("react_to_message delivery", () => {
  it.each([
    ["👍", { type: "like" }],
    ["👎", { type: "dislike" }],
    ["❤️", { type: "love" }],
    ["😂", { type: "laugh" }],
    ["‼️", { type: "emphasize" }],
    ["❓", { type: "question" }],
    ["✅", { type: "custom", custom_emoji: "✅" }],
    ["👀", { type: "custom", custom_emoji: "👀" }],
    ["👍🏽", { type: "custom", custom_emoji: "👍🏽" }],
    ["👩🏽‍💻", { type: "custom", custom_emoji: "👩🏽‍💻" }],
    ["🇺🇸", { type: "custom", custom_emoji: "🇺🇸" }],
  ] as const)(
    "delivers %s add and remove to the explicit message through Linq",
    async (emoji, expected) => {
      const tool = await reactionTool();
      for (const operation of ["add", "remove"] as const) {
        controls.fetch.mockClear();
        const input = { messageId: second, emoji, operation };
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each operation is verified against its own ordered request capture.
        await expect(tool.execute(input, toolContext())).resolves.toEqual(
          input
        );
        expect(controls.fetch).toHaveBeenCalledTimes(2);
        const lookup = requestAt(0);
        const delivery = requestAt(1);
        expect(lookup.url).toBe(
          `https://api.linqapp.com/api/partner/v3/messages/${second}`
        );
        expect(lookup.method).toBe("GET");
        expect(delivery.url).toBe(
          `https://api.linqapp.com/api/partner/v3/messages/${second}/reactions`
        );
        expect(delivery.method).toBe("POST");
        // oxlint-disable-next-line eslint/no-await-in-loop -- Read this operation's request before resetting the capture for the next operation.
        expect(await delivery.json()).toEqual({ operation, ...expected });
      }
    }
  );

  it("targets earlier and newer messages without using the cached incoming message ID", async () => {
    const tool = await reactionTool();
    const context = toolContext();
    for (const messageId of [second, third, first, second]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- These calls represent successive reactions within one session.
      await tool.execute({ messageId, emoji: "👀", operation: "add" }, context);
    }
    expect(
      Array.from({ length: 8 }, (_, index) => requestAt(index).url)
    ).toEqual(
      [second, third, first, second].flatMap((id) => [
        `https://api.linqapp.com/api/partner/v3/messages/${id}`,
        `https://api.linqapp.com/api/partner/v3/messages/${id}/reactions`,
      ])
    );
  });

  it.each(["add", "remove"] as const)(
    "rejects %s on another chat's message without a fallback",
    async (operation) => {
      controls.chatId = "other-chat";
      const tool = await reactionTool();
      await expect(
        tool.execute(
          { messageId: second, emoji: "👀", operation },
          toolContext()
        )
      ).rejects.toThrow("current conversation");
      expect(controls.fetch).toHaveBeenCalledOnce();
    }
  );

  it.each(["not-a-message-id", `${second},`])(
    "rejects invalid Linq target %s before provider calls",
    async (messageId) => {
      const tool = await reactionTool();
      await expect(
        tool.execute(
          { messageId, emoji: "👀", operation: "add" },
          toolContext()
        )
      ).rejects.toThrow("valid Linq UUID");
      expect(controls.apiKey).not.toHaveBeenCalled();
      expect(controls.fetch).not.toHaveBeenCalled();
    }
  );

  it.each(["thumbs_up", "👀👍", "👀🏽", "👀\n"])(
    "rejects invalid emoji %j before delivery and permits correction",
    async (emoji) => {
      const tool = await reactionTool();
      await expect(
        tool.execute(
          { messageId: second, emoji, operation: "add" },
          toolContext()
        )
      ).rejects.toThrow("Provide exactly one real Unicode emoji");
      expect(controls.fetch).not.toHaveBeenCalled();
      const corrected = {
        messageId: second,
        emoji: "👀",
        operation: "add",
      } as const;
      await expect(tool.execute(corrected, toolContext())).resolves.toEqual(
        corrected
      );
    }
  );

  it.each([404, 500])(
    "fails the tool when target lookup returns %s",
    async (status) => {
      controls.fetch.mockResolvedValueOnce(
        new Response("Target unavailable", { status })
      );
      const tool = await reactionTool();
      await expect(
        tool.execute(
          { messageId: second, emoji: "👍", operation: "add" },
          toolContext()
        )
      ).rejects.toThrow(String(status));
      expect(controls.fetch).toHaveBeenCalledOnce();
    }
  );

  it("fails the tool when Linq rejects the reaction", async () => {
    controls.fetch
      .mockResolvedValueOnce(Response.json({ id: second, chat_id: "chat-1" }))
      .mockResolvedValueOnce(
        new Response("Reaction rejected", { status: 400 })
      );
    const tool = await reactionTool();
    await expect(
      tool.execute(
        { messageId: second, emoji: "👍", operation: "add" },
        toolContext()
      )
    ).rejects.toThrow("400");
    expect(controls.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not complete until the provider accepts the reaction", async () => {
    const response = Promise.withResolvers<Response>();
    controls.fetch.mockImplementation(async (input, init) => {
      if (!new Request(input, init).url.endsWith("/reactions"))
        return Response.json({ id: second, chat_id: "chat-1" });
      return await response.promise;
    });
    const tool = await reactionTool();
    const completed = vi.fn<() => void>();
    const call = Promise.resolve(
      tool.execute(
        { messageId: second, emoji: "👍", operation: "add" },
        toolContext()
      )
    ).then(completed);
    await vi.waitFor(() => {
      expect(controls.fetch).toHaveBeenCalledTimes(2);
    });
    expect(completed).not.toHaveBeenCalled();
    response.resolve(Response.json({ status: "accepted" }));
    await call;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("requires authentication for native reactions", async () => {
    const tool = await reactionTool();
    const context = toolContext();
    await expect(
      tool.execute(
        { messageId: second, emoji: "👍", operation: "add" },
        {
          ...context,
          session: {
            ...context.session,
            auth: { current: null, initiator: null },
          },
        }
      )
    ).rejects.toThrow("authenticated Linq conversation");
    expect(controls.fetch).not.toHaveBeenCalled();
  });

  it("rejects a mismatch between the authenticated conversation and Linq thread", async () => {
    const tool = await reactionTool();
    const context = toolContext();
    context.session.auth.current.attributes.linqThreadId = "linq:other-chat";
    await expect(
      tool.execute(
        { messageId: second, emoji: "👍", operation: "add" },
        context
      )
    ).rejects.toThrow("authenticated Linq conversation");
    expect(controls.fetch).not.toHaveBeenCalled();
  });

  it("preserves explicit Unicode reactions in browser chat without provider delivery", async () => {
    const tool = await reactionTool("eve");
    const input = reactToMessageInputSchema.parse({
      messageId: "turn-1:user",
      emoji: "👩🏽‍💻",
    });
    expect(tool.description).toContain(
      "current browser messageId is turn-1:user"
    );
    await expect(tool.execute(input, toolContext("eve"))).resolves.toEqual(
      input
    );
    expect(controls.apiKey).not.toHaveBeenCalled();
    expect(controls.fetch).not.toHaveBeenCalled();
  });
});

async function reactionTool(channel: "linq" | "eve" = "linq") {
  const context = toolContext(channel);
  const dynamic = {
    session: context.session,
    model: null,
    messages: [],
    channel: { kind: `channel:${channel}`, metadata: {} },
  } satisfies DynamicResolveContext;
  const resolve = messaging.events["turn.started"];
  if (!resolve) throw new Error("Messaging resolver is unavailable");
  const tools = await resolve(
    { type: "turn.started", data: { turnId: "turn-1" } },
    dynamic
  );
  if (!tools || !("react_to_message" in tools))
    throw new Error("Reaction tool is unavailable");
  return tools.react_to_message;
}

function toolContext(channel: "linq" | "eve" = "linq") {
  return {
    abortSignal: new AbortController().signal,
    callId: "react-call",
    toolName: "react_to_message",
    getSandbox: async () => {
      throw new Error("Unexpected sandbox access");
    },
    getToken: async () => {
      throw new Error("Unexpected token access");
    },
    requireAuth: () => {
      throw new Error("Unexpected connection authorization");
    },
    session: {
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
      auth: {
        current: {
          principalId: "user-1",
          principalType: "user",
          authenticator: "linq-message",
          attributes: {
            conversationChannel: channel,
            conversationId: "linq:chat-1",
            linqThreadId: "linq:chat-1",
            linqMessageId: first,
          },
        },
        initiator: null,
      },
    },
  } satisfies ToolContext;
}

function requestAt(index: number) {
  const [input, init] = controls.fetch.mock.calls[index] ?? [];
  if (!input) throw new Error("Expected a Linq request");
  return new Request(input, init);
}

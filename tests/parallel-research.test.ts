import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const endpoint = "https://api.parallel.ai/v1/responses";
const apiKey = "test-parallel-key-must-not-leak";
const nativeFetch = globalThis.fetch;
const fetchMock = vi.fn<typeof fetch>();
const requiredEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret",
  BETTER_AUTH_URL: "https://example.com",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};
const resolverContext = {
  channel: {
    kind: "http",
    metadata: {
      screenshot: "private-screenshot",
      workspace: "private-workspace",
    },
  },
  messages: [{ role: "user", content: "private-conversation-history" }],
  session: {
    auth: { current: null, initiator: null },
    id: "private-session",
  },
} satisfies DynamicResolveContext;

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries(requiredEnvironment)) {
    vi.stubEnv(name, value);
  }
  vi.stubEnv("PARALLEL_API_KEY", apiKey);
  vi.stubEnv("LINQ_CONNECTOR", "");
  vi.stubEnv("LINQ_PHONE_NUMBER", "");
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json(completedResponse()))
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Parallel research", () => {
  it.each([undefined, ""])(
    "stays unavailable with an unset key (%s)",
    async (key) => {
      vi.stubEnv("PARALLEL_API_KEY", key);
      expect(await resolveResearch("session.started")).toBeNull();
      expect(await resolveResearch("turn.started")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("rejects a whitespace-only key through the existing environment contract", async () => {
    vi.stubEnv("PARALLEL_API_KEY", " \n ");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(resolveResearch()).rejects.toThrow(
      "Invalid environment variables"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["low", "medium", "high"])(
    "forwards explicit %s effort",
    async (effort) => {
      await research({ query: "A public question", effort });
      expect(requestBody()).toMatchObject({ reasoning: { effort } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["a".repeat(20_000), "🛰".repeat(20_000)])(
    "accepts exactly 20,000 Unicode code points without truncation",
    async (query) => {
      await research({ query });
      expect(requestBody()).toMatchObject({ input: query });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["missing query", {}],
    ["empty query", { query: "" }],
    ["whitespace query", { query: " \n\t " }],
    ["non-string query", { query: 42 }],
    ["oversized ASCII query", { query: "x".repeat(20_001) }],
    ["oversized astral query", { query: "🛰".repeat(20_001) }],
    ["unknown effort", { query: "public", effort: "extreme" }],
    ["null effort", { query: "public", effort: null }],
    ["empty prior ID", { query: "public", previous_response_id: "" }],
    ["whitespace prior ID", { query: "public", previous_response_id: " \n " }],
    [
      "embedded whitespace ID",
      { query: "public", previous_response_id: "resp two" },
    ],
    ["null prior ID", { query: "public", previous_response_id: null }],
    ["numeric prior ID", { query: "public", previous_response_id: 17 }],
    [
      "object prior ID",
      { query: "public", previous_response_id: { id: "resp_1" } },
    ],
  ])("rejects %s at execution before HTTP", async (_name, input) => {
    await expect(research(input)).rejects.toThrow(/invalid research input/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves answer formatting and deduplicates safe citation URLs", async () => {
    const first = "  Findings:\n\n- One.  ";
    const second = "Second paragraph.\n";
    const response = completedResponse(first, [
      {
        type: "url_citation",
        url: "https://docs.example.com/a",
        title: "",
        start_index: 0,
        end_index: 0,
      },
      {
        type: "url_citation",
        url: "https://docs.example.com/a",
        title: "Duplicate",
        start_index: 3,
        end_index: 7,
      },
      {
        type: "url_citation",
        url: "http://example.com/b",
        title: "Second source",
      },
      { type: "url_citation", url: "https://docs.example.com/c" },
      { type: "url_citation", url: "javascript:alert(1)", title: "Unsafe" },
      { type: "url_citation", url: "file:///private/file", title: "Local" },
      {
        type: "url_citation",
        url: "https://user:secret@example.com/",
        title: "Credentials",
      },
      { type: "url_citation", url: "not a URL", title: "Invalid" },
      {
        type: "file_citation",
        url: "https://example.com/not-a-url-citation",
        title: "Other type",
      },
      null,
    ]);
    response.output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: second, annotations: [] }],
    });
    response.output.push({
      type: "reasoning",
      role: "assistant",
      content: [
        { type: "output_text", text: "Not an answer", annotations: [] },
      ],
    });
    fetchMock.mockResolvedValueOnce(Response.json(response));
    await expect(research({ query: "A public question" })).resolves.toEqual({
      answer: `${first}\n\n${second}`,
      response_id: "resp_current",
      sources: [
        { url: "https://docs.example.com/a", title: "" },
        { url: "http://example.com/b", title: "Second source" },
        { url: "https://docs.example.com/c", title: "" },
      ],
    });
  });

  it("accepts a completed answer without annotations or a new response ID", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "A useful answer." }],
          },
        ],
      })
    );
    await expect(
      research({ query: "Follow up", previous_response_id: "resp_previous" })
    ).resolves.toEqual({ answer: "A useful answer.", sources: [] });
  });

  it.each([null, 0, "", " \n ", "id with spaces", { id: "nested" }])(
    "omits a malformed returned ID (%j) without reusing the prior ID",
    async (id) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ ...completedResponse(), id })
      );
      await expect(
        research({ query: "Follow up", previous_response_id: "resp_previous" })
      ).resolves.toEqual({
        answer: "The official documentation is available online.",
        sources: [],
      });
    }
  );

  it.each(["opaque:branch/a?b=1", `opaque:${"a".repeat(600)}`])(
    "treats response IDs as opaque rather than imposing a prefix or length cap",
    async (id) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({ ...completedResponse(), id })
      );
      await expect(
        research({ query: "Follow up", previous_response_id: id })
      ).resolves.toMatchObject({ response_id: id });
      expect(requestBody()).toMatchObject({ previous_response_id: id });
    }
  );

  it("uses explicit continuation only and leaves later questions independent", async () => {
    const first = await research({ query: "Initial question" });
    await research({
      query: "Follow up",
      previous_response_id: first.response_id,
    });
    await research({ query: "Independent question" });
    expect(requestBody(0)).not.toHaveProperty("previous_response_id");
    expect(requestBody(1)).toMatchObject({
      previous_response_id: "resp_current",
    });
    expect(requestBody(2)).not.toHaveProperty("previous_response_id");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps concurrent independent requests separate", async () => {
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...completedResponse("Second answer"),
        id: "resp_second",
      })
    );
    const first = research({ query: "First question" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await expect(research({ query: "Second question" })).resolves.toMatchObject(
      { answer: "Second answer", response_id: "resp_second" }
    );
    pending.resolve(
      Response.json({ ...completedResponse("First answer"), id: "resp_first" })
    );
    await expect(first).resolves.toMatchObject({
      answer: "First answer",
      response_id: "resp_first",
    });
    expect(requestBody(0)).toMatchObject({ input: "First question" });
    expect(requestBody(1)).toMatchObject({ input: "Second question" });
    expect(requestBody(0)).not.toHaveProperty("previous_response_id");
    expect(requestBody(1)).not.toHaveProperty("previous_response_id");
  });

  it.each([400, 401, 403, 404, 429, 500])(
    "reports HTTP %s without leaking the body or retrying a follow-up",
    async (status) => {
      const query = "private-query-must-not-leak";
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: `raw-provider-body ${apiKey} ${query}` },
          }),
          { status }
        )
      );
      const error = await research({
        query,
        previous_response_id: "opaque-unauthorized",
      }).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(`HTTP ${String(status)}`);
      expect(String(error)).not.toContain(apiKey);
      expect(String(error)).not.toContain(query);
      expect(String(error)).not.toContain("raw-provider-body");
      expect(
        String(error).includes("Check the server's PARALLEL_API_KEY")
      ).toBe(status === 401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestBody()).toMatchObject({
        previous_response_id: "opaque-unauthorized",
      });
    }
  );

  it.each([
    ["null payload", null],
    ["missing status", { output: completedResponse().output }],
    ["failed status", { ...completedResponse(), status: "failed" }],
    ["incomplete status", { ...completedResponse(), status: "incomplete" }],
    ["empty output", { status: "completed", output: [] }],
    ["missing content", { status: "completed", output: [{ type: "message" }] }],
    [
      "missing text",
      {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text" }] }],
      },
    ],
    [
      "non-string text",
      {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: 5 }] },
        ],
      },
    ],
    ["whitespace answer", completedResponse(" \n\t ")],
    [
      "non-message answer",
      {
        status: "completed",
        output: [
          {
            type: "reasoning",
            content: [{ type: "output_text", text: "Not an answer" }],
          },
        ],
      },
    ],
  ])("rejects %s instead of reporting success", async (_name, value) => {
    fetchMock.mockResolvedValueOnce(Response.json(value));
    await expect(research({ query: "Public question" })).rejects.toThrow(
      /Parallel/u
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sanitizes malformed JSON and transport failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response(`malformed ${apiKey}`));
    const malformed = await research({ query: "Public question" }).catch(
      (error: unknown) => error
    );
    expect(malformed).toBeInstanceOf(Error);
    expect(String(malformed)).not.toContain(apiKey);
    fetchMock.mockRejectedValueOnce(new TypeError(`request failed: ${apiKey}`));
    const transport = await research({ query: "Public question" }).catch(
      (error: unknown) => error
    );
    expect(transport).toBeInstanceOf(Error);
    expect(String(transport)).not.toContain(apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not start HTTP for a pre-cancelled call", async () => {
    const controller = new AbortController();
    controller.abort(new Error(`private abort reason ${apiKey}`));
    await expect(
      research({ query: "Public question" }, controller.signal)
    ).rejects.toThrow(/cancelled/iu);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["headers", "cancel"],
    ["body", "cancel"],
    ["headers", "timeout"],
    ["body", "timeout"],
  ] as const)(
    "aborts native fetch waiting for %s on %s",
    async (phase, cause) => {
      const arrived = Promise.withResolvers<undefined>();
      const closed = Promise.withResolvers<undefined>();
      const caller = new AbortController();
      const deadline = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(deadline.signal);
      await withResponseServer(
        (_request, response) => {
          response.once("close", () => {
            closed.resolve(undefined);
          });
          if (phase === "body") {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.write('{"status":"completed","output":');
          }
          arrived.resolve(undefined);
        },
        async () => {
          const result = research({ query: "Public question" }, caller.signal);
          await arrived.promise;
          if (phase === "body") await fetchMock.mock.results[0]?.value;
          if (cause === "timeout") {
            deadline.abort(new DOMException("Deadline", "TimeoutError"));
          } else {
            caller.abort(new Error(`private reason ${apiKey}`));
          }
          await expect(result).rejects.toThrow(
            cause === "timeout" ? /timed out/iu : /cancelled/iu
          );
          await closed.promise;
          expect(timeout).toHaveBeenCalledExactlyOnceWith(120_000);
          expect(fetchMock).toHaveBeenCalledTimes(1);
        }
      );
    }
  );

  it("rejects a real redirect without sending the credential to its target", async () => {
    const paths: string[] = [];
    await withResponseServer(
      (request, response) => {
        paths.push(request.url ?? "");
        response.writeHead(302, { Location: "/do-not-follow" });
        response.end();
      },
      async () => {
        await expect(research({ query: "Public question" })).rejects.toThrow(
          /could not finish/iu
        );
        expect(paths).toEqual(["/v1/responses"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );
  });

  it.each(["session.started", "turn.started"] as const)(
    "resolves an optional tool on %s without making a request",
    async (event) => {
      const tool = await resolveResearch(event);
      expect(tool?.execute).toBeTypeOf("function");
      if (!tool || !(tool.inputSchema instanceof z.ZodType)) {
        throw new Error("Research must expose a Zod input schema.");
      }
      expect(tool.inputSchema.parse({ query: "A public question" })).toEqual({
        query: "A public question",
        effort: "low",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("sends only the exact question and protocol fields, never ambient or extra input", async () => {
    const query =
      "  Find the official Bun documentation.\nUse public sources.  ";
    await expect(
      research({
        query,
        instructions: "must-not-forward",
        screenshots: ["private-image"],
        messages: resolverContext.messages,
        tools: [{ name: "private-tool" }],
        api_key: "untrusted-override",
        store: false,
      })
    ).resolves.toEqual({
      answer: "The official documentation is available online.",
      response_id: "resp_current",
      sources: [],
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        redirect: "error",
      })
    );
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Bearer ${apiKey}`
    );
    expect(new Headers(options?.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(requestBody()).toEqual({
      input: query,
      model: "parallel",
      reasoning: { effort: "low" },
      stream: false,
    });
  });
});

async function resolveResearch(
  event: "session.started" | "turn.started" = "session.started"
) {
  const { default: definition } = await import("../agent/tools/web_research");
  const resolve = definition.events[event];
  if (!resolve) {
    throw new Error(`Missing research resolver for ${event}.`);
  }
  return resolve({ type: event }, resolverContext);
}

async function research(input: unknown, signal = new AbortController().signal) {
  const tool = await resolveResearch();
  if (!tool) {
    throw new Error("Research tool is unavailable.");
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exercise validation of raw runtime input in the real executor, including deliberately invalid cases.
  const raw = input as Parameters<typeof tool.execute>[0];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the real executor may access only abortSignal; ambient Eve context is deliberately unavailable.
  const context = new Proxy(
    { abortSignal: signal },
    {
      get(target, property) {
        if (property === "abortSignal") return target.abortSignal;
        throw new Error(
          `Unexpected research context access: ${String(property)}`
        );
      },
    }
  ) as ToolContext;
  const result = await tool.execute(raw, context);
  if (Symbol.asyncIterator in result) {
    throw new Error("Research must return one completed result.");
  }
  return result;
}

function requestBody(index = 0): unknown {
  const body = fetchMock.mock.calls[index]?.[1]?.body;
  if (typeof body !== "string") {
    throw new Error("Research must send a JSON request body.");
  }
  return JSON.parse(body);
}

function completedResponse(
  text = "The official documentation is available online.",
  annotations: unknown[] = []
) {
  return {
    id: "resp_current",
    output: [
      {
        content: [
          {
            annotations,
            text,
            type: "output_text",
          },
        ],
        role: "assistant",
        type: "message",
      },
    ],
    status: "completed",
  };
}

async function withResponseServer(
  onRequest: RequestListener,
  run: () => Promise<void>
) {
  const server = createServer(onRequest);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing loopback address.");
  fetchMock.mockImplementation((url, options) => {
    expect(url).toBe(endpoint);
    return nativeFetch(
      `http://127.0.0.1:${String(address.port)}/v1/responses`,
      options
    );
  });
  try {
    await run();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

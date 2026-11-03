import { createServer } from "node:http";
import * as GmailApi from "@googleapis/gmail";
import type { ToolContext } from "eve/tools";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { gmailReadThread } from "@agent/tools/gmail";
import { toolContextFor } from "@tests/helpers/tool-context";

let thread: GmailApi.gmail_v1.Schema$Thread = {};
const bodies = new Map<string, GmailApi.gmail_v1.Schema$MessagePartBody>();
const requests: { authorization: string | undefined; path: string }[] = [];
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  requests.push({
    authorization: request.headers.authorization,
    path: url.pathname,
  });
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/gmail/v1/users/me/threads/thread-fixture") {
    response.end(JSON.stringify(thread));
    return;
  }
  const body = bodies.get(url.pathname);
  if (body) {
    response.end(JSON.stringify(body));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { message: "Unknown fixture path" } }));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  const rootUrl = `http://127.0.0.1:${String(address.port)}`;
  // Keep the generated Google client, OAuth header and transport; only redirect the external SDK boundary to the local fixture.
  vi.spyOn(GmailApi, "gmail").mockImplementation(
    (options) => new GmailApi.gmail_v1.Gmail({ ...options, rootUrl })
  );
});

beforeEach(() => {
  bodies.clear();
  requests.length = 0;
  thread = { id: "thread-fixture", messages: [] };
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
});

describe("Gmail thread text bodies", () => {
  it.each([undefined, ""])(
    "reads an external text body with data=%s through the generated attachments API",
    async (data) => {
      thread.messages = [
        {
          id: "message-fixture",
          payload: {
            body: { attachmentId: "body-fixture", data, size: 45 },
            mimeType: "text/plain",
          },
        },
      ];
      bodies.set(
        "/gmail/v1/users/me/messages/message-fixture/attachments/body-fixture",
        { data: encode("Meet at noon. Your verification code is 123456.") }
      );

      const result = await gmailReadThread.execute(
        { threadId: "thread-fixture" },
        context()
      );
      expect(result).toMatchObject({
        thread: {
          messages: [
            {
              body: "Meet at noon. Your verification code is [six-digit code redacted].",
            },
          ],
        },
      });
      expect(requests.map((request) => request.path)).toEqual([
        "/gmail/v1/users/me/threads/thread-fixture",
        "/gmail/v1/users/me/messages/message-fixture/attachments/body-fixture",
      ]);
      expect(
        requests.every(
          (request) => request.authorization === "Bearer fixture-token"
        )
      ).toBe(true);
    }
  );

  it("keeps inline and empty text bodies without additional requests", async () => {
    thread.messages = [
      {
        id: "inline",
        payload: {
          mimeType: "text/plain",
          body: { data: encode("Inline text") },
        },
      },
      { id: "empty", payload: { mimeType: "text/plain", body: { size: 0 } } },
    ];
    const result = await gmailReadThread.execute(
      { threadId: "thread-fixture" },
      context()
    );
    expect(result).toMatchObject({
      thread: { messages: [{ body: "Inline text" }, { body: "" }] },
    });
    expect(requests).toHaveLength(1);
  });

  it("reads external HTML within a multipart body without downloading named attachments", async () => {
    thread.messages = [
      {
        id: "multipart",
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "text/html",
              body: { attachmentId: "html-body", size: 19 },
            },
            {
              filename: "invoice.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "invoice", size: 200 },
            },
          ],
        },
      },
    ];
    bodies.set("/gmail/v1/users/me/messages/multipart/attachments/html-body", {
      data: encode("<p>Receipt ready</p>"),
    });
    const result = await gmailReadThread.execute(
      { threadId: "thread-fixture" },
      context()
    );
    expect(result).toMatchObject({
      thread: {
        messages: [
          {
            body: " Receipt ready ",
            attachments: [
              { attachmentId: "invoice", filename: "invoice.pdf", size: 200 },
            ],
          },
        ],
      },
    });
    expect(requests.map((request) => request.path)).toEqual([
      "/gmail/v1/users/me/threads/thread-fixture",
      "/gmail/v1/users/me/messages/multipart/attachments/html-body",
    ]);
  });

  it("preserves nested inline bodies and excludes named text attachments", async () => {
    thread.messages = [
      {
        id: "nested",
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              filename: "notes.txt",
              mimeType: "text/plain",
              body: { attachmentId: "notes" },
            },
            {
              mimeType: "multipart/alternative",
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: encode("Nested body") },
                },
                {
                  mimeType: "text/html",
                  body: { data: encode("<p>Alternative body</p>") },
                },
              ],
            },
          ],
        },
      },
    ];
    const result = await gmailReadThread.execute(
      { threadId: "thread-fixture" },
      context()
    );
    expect(result).toMatchObject({
      thread: { messages: [{ body: "Nested body" }] },
    });
    expect(requests).toHaveLength(1);
  });

  it("surfaces an attachment retrieval failure instead of returning an empty body", async () => {
    thread.messages = [
      {
        id: "missing-body",
        payload: {
          mimeType: "text/plain",
          body: { attachmentId: "unavailable" },
        },
      },
    ];
    await expect(
      gmailReadThread.execute({ threadId: "thread-fixture" }, context())
    ).rejects.toThrow("Unknown fixture path");
  });
});

function encode(text: string) {
  return Buffer.from(text, "utf8").toString("base64url");
}

function context() {
  return {
    ...toolContextFor({ callId: "read-fixture", sessionId: "gmail-fixture" }),
    getToken: vi
      .fn<ToolContext["getToken"]>()
      .mockResolvedValue({ token: "fixture-token" }),
  } satisfies ToolContext;
}

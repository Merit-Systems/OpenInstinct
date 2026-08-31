import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn<() => Promise<unknown>>(),
  handler: vi.fn<(request: Request) => Promise<Response>>(),
  toNextJsHandler: vi.fn<
    (_auth: unknown) => {
      GET: (request: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    }
  >(),
}));

vi.mock("@/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: mocks.toNextJsHandler,
}));

import { GET } from "../app/api/auth/[...all]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handler.mockResolvedValue(Response.json({ ok: true }));
  mocks.toNextJsHandler.mockReturnValue({
    GET: mocks.handler,
    POST: mocks.handler,
  });
});

describe("auth route initialization", () => {
  it("retries after transient installation-secret failures", async () => {
    mocks.getAuth
      .mockRejectedValueOnce(new Error("Blob temporarily unavailable"))
      .mockResolvedValueOnce({});
    const request = new Request(
      "https://openinstinct.example/api/auth/session"
    );

    await expect(GET(request)).rejects.toThrow("Blob temporarily unavailable");
    await expect(GET(request)).resolves.toMatchObject({ status: 200 });
    expect(mocks.getAuth).toHaveBeenCalledTimes(2);
    expect(mocks.handler).toHaveBeenCalledOnce();
  });
});

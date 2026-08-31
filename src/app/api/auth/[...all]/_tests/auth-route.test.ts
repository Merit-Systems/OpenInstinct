import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRouteDependencies, GET } from "@/app/api/auth/[...all]/route";

const handler = vi.fn<(request: Request) => Promise<Response>>();
const loadHandlersMock = vi.spyOn(authRouteDependencies, "loadHandlers");

beforeEach(() => {
  vi.clearAllMocks();
  handler.mockResolvedValue(Response.json({ ok: true }));
});

describe("auth route initialization", () => {
  it("retries after transient installation-secret failures", async () => {
    loadHandlersMock
      .mockRejectedValueOnce(new Error("Blob temporarily unavailable"))
      .mockResolvedValueOnce({
        DELETE: handler,
        GET: handler,
        PATCH: handler,
        POST: handler,
        PUT: handler,
      });
    const request = new Request(
      "https://openinstinct.example/api/auth/session"
    );

    await expect(GET(request)).rejects.toThrow("Blob temporarily unavailable");
    await expect(GET(request)).resolves.toMatchObject({ status: 200 });
    expect(loadHandlersMock).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledOnce();
  });
});

/* oxlint-disable vitest/require-mock-type-parameters -- Hoisted auth and storage fakes are configured per test. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  getBlob: vi.fn(),
  scopeEnforcementEnabled: vi.fn<() => boolean>(),
  verifyScopeAccess: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/auth/session", () => ({ getAuthSession: mocks.getAuthSession }));
vi.mock("@/lib/browser-images/server", () => ({
  getBrowserImageBlob: mocks.getBlob,
}));
vi.mock("@/db/services/scope", () => ({
  verifyScopeAccess: mocks.verifyScopeAccess,
}));
vi.mock("@/lib/env", () => ({
  isWorkspaceScopeEnforcementEnabled: mocks.scopeEnforcementEnabled,
}));

import { GET } from "@/app/artifacts/[artifactId]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.scopeEnforcementEnabled.mockReturnValue(false);
  mocks.getBlob.mockResolvedValue({
    artifact: {
      byteSize: png.byteLength,
      filename: "Product image.png",
      mediaType: "image/png",
    },
    result: {
      blob: { etag: '"etag"' },
      statusCode: 200,
      stream: new Response(png).body,
    },
  });
});

describe("browser image route", () => {
  it("streams an authenticated artifact with private security headers", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain(
      "Product%20image.png"
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("passes conditional ETags through to private Blob", async () => {
    mocks.getBlob.mockResolvedValue({
      artifact: {},
      result: {
        blob: { etag: '"etag"' },
        statusCode: 304,
        stream: null,
      },
    });

    const response = await GET(
      request({ "if-none-match": '"etag"' }),
      context()
    );

    expect(response.status).toBe(304);
    expect(mocks.getBlob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "better-auth:user-1" }),
      artifactId,
      expect.objectContaining({ ifNoneMatch: '"etag"' })
    );
  });

  it.each([
    ["unauthenticated", null, artifactId],
    ["invalid id", { user: { id: "user-1" } }, "not-an-id"],
  ])(
    "returns the same not-found response for %s requests",
    async (_name, session, id) => {
      mocks.getAuthSession.mockResolvedValue(session);

      const response = await GET(request(), context(id));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
      expect(mocks.getBlob).not.toHaveBeenCalled();
    }
  );

  it("does not reveal an unavailable or cross-workspace artifact", async () => {
    mocks.getBlob.mockResolvedValue(undefined);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("does not reveal an artifact for a denied enforced scope", async () => {
    mocks.scopeEnforcementEnabled.mockReturnValue(true);
    mocks.verifyScopeAccess.mockResolvedValue(undefined);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });
});

function request(headers?: HeadersInit) {
  return new Request(`https://example.com/artifacts/${artifactId}`, {
    headers,
  });
}

function context(id = artifactId) {
  return { params: Promise.resolve({ artifactId: id }) };
}

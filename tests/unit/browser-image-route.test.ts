/* oxlint-disable vitest/require-mock-type-parameters -- Hoisted auth and storage fakes are configured per test. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as AuthSession from "@/auth/session";
import { GET } from "@/app/artifacts/[artifactId]/route";
import * as ScopeService from "@/db/services/scope";
import * as BrowserImageServer from "@/lib/browser-images/server";
import * as Environment from "@/lib/env";
import { authSessionFor } from "../helpers/auth-session";

const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const getAuthSessionMock = vi.spyOn(AuthSession, "getAuthSession");
const getBlobMock = vi.spyOn(BrowserImageServer, "getBrowserImageBlob");
const scopeEnforcementEnabledMock = vi.spyOn(
  Environment,
  "isWorkspaceScopeEnforcementEnabled"
);
const verifyScopeAccessMock = vi.spyOn(ScopeService, "verifyScopeAccess");
type OpenedBrowserImage = NonNullable<
  Awaited<ReturnType<typeof BrowserImageServer.getBrowserImageBlob>>
>;
const verifiedScope: NonNullable<
  Awaited<ReturnType<typeof ScopeService.verifyScopeAccess>>
> = {
  membershipStatus: "active",
  role: "owner",
  userId: "better-auth:user-1",
  workspaceId: "workspace-1",
};

function openedBrowserImage(statusCode: 200 | 304): OpenedBrowserImage {
  const stream = statusCode === 200 ? new Response(png).body : null;
  const artifact = {
    browserSessionId: "browser-1",
    byteSize: png.byteLength,
    contentHash: "content-hash",
    createdAt: "2026-08-31T00:00:00.000Z",
    createdByUserId: "user-1",
    filename: "Product image.png",
    id: artifactId,
    idempotencyKey: "image-call-1",
    label: "Product image",
    mediaType: "image/png",
    rootSessionId: "root-session",
    sourceKind: "viewport",
    status: "ready",
    storagePathname: `browser-images/workspace/${artifactId}`,
    workerSessionId: "worker-1",
    workspaceId: "workspace-1",
  };
  const blob = {
    cacheControl: "private, max-age=3600",
    contentDisposition: 'inline; filename="Product image.png"',
    downloadUrl: "https://blob.example/download",
    etag: '"etag"',
    pathname: `browser-images/workspace/${artifactId}`,
    uploadedAt: new Date("2026-08-31T00:00:00.000Z"),
    url: "https://blob.example/image",
  };
  if (statusCode === 304) {
    return {
      artifact,
      result: {
        blob: { ...blob, contentType: null, size: null },
        headers: new Headers(),
        statusCode,
        stream: null,
      },
    };
  }
  if (!stream) throw new Error("The test Response did not expose a body.");
  return {
    artifact,
    result: {
      blob: { ...blob, contentType: "image/png", size: png.byteLength },
      headers: new Headers(),
      statusCode,
      stream,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthSessionMock.mockResolvedValue(
    authSessionFor({
      id: "user-1",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    })
  );
  getBlobMock.mockResolvedValue(openedBrowserImage(200));
  scopeEnforcementEnabledMock.mockReturnValue(false);
  verifyScopeAccessMock.mockResolvedValue(verifiedScope);
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
    getBlobMock.mockResolvedValue(openedBrowserImage(304));

    const response = await GET(
      request({ "if-none-match": '"etag"' }),
      context()
    );

    expect(response.status).toBe(304);
    expect(getBlobMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "better-auth:user-1" }),
      artifactId,
      expect.objectContaining({ ifNoneMatch: '"etag"' })
    );
  });

  it.each([
    ["unauthenticated", null, artifactId],
    [
      "invalid id",
      authSessionFor({
        id: "user-1",
        phoneNumber: "+12025550123",
        phoneNumberVerified: true,
      }),
      "not-an-id",
    ],
  ])(
    "returns the same not-found response for %s requests",
    async (_name, session, id) => {
      getAuthSessionMock.mockResolvedValue(session);

      const response = await GET(request(), context(id));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
      expect(getBlobMock).not.toHaveBeenCalled();
    }
  );

  it("does not reveal an unavailable or cross-workspace artifact", async () => {
    getBlobMock.mockResolvedValue(undefined);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("does not reveal an artifact for a denied enforced scope", async () => {
    scopeEnforcementEnabledMock.mockReturnValue(true);
    verifyScopeAccessMock.mockResolvedValue(undefined);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(getBlobMock).not.toHaveBeenCalled();
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

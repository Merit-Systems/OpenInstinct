/* oxlint-disable vitest/require-mock-type-parameters -- Hoisted Blob and database fakes are configured per test. */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { maximumBrowserImageBytes } from "../../lib/browser-images";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  finalize: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  readReady: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  del: mocks.del,
  get: mocks.get,
  put: mocks.put,
}));
vi.mock("@/db/services/browser-images", () => ({
  finalizeBrowserImageArtifact: mocks.finalize,
  readReadyBrowserImageArtifact: mocks.readReady,
}));

import {
  browserImageBlobAuthentication,
  persistReservedBrowserImage,
  readBoundedResponse,
  readBrowserImageBytes,
} from "../../lib/browser-images/server";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scope = { userId: "user-1", workspaceId: "workspace-1" };
const reservation = {
  id: "0d01e667-d128-4bb7-a248-1ae21db72f4f",
  storagePathname:
    "browser-images/workspace/0d01e667-d128-4bb7-a248-1ae21db72f4f",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.del.mockResolvedValue(undefined);
  mocks.put.mockResolvedValue({ pathname: reservation.storagePathname });
  mocks.finalize.mockResolvedValue({
    image: { id: reservation.id },
    storagePathname: `${reservation.storagePathname}/${createHash("sha256")
      .update(png)
      .digest("hex")}`,
  });
});

describe("browser image storage", () => {
  it("prefers a connected store for OIDC and retains token fallback", () => {
    expect(
      browserImageBlobAuthentication({
        readWriteToken: "legacy-token",
        storeId: "store_openinstinct",
      })
    ).toEqual({ storeId: "store_openinstinct" });
    expect(
      browserImageBlobAuthentication({ readWriteToken: "legacy-token" })
    ).toEqual({ token: "legacy-token" });
    expect(() => browserImageBlobAuthentication({})).toThrow(
      "Browser image storage is not configured"
    );
  });

  it("uploads a private bounded image and finalizes its manifest", async () => {
    await persistReservedBrowserImage(scope, reservation, {
      bytes: png,
      filename: "product.png",
      sourceKind: "viewport",
    });

    expect(mocks.put).toHaveBeenCalledWith(
      `${reservation.storagePathname}/${createHash("sha256")
        .update(png)
        .digest("hex")}`,
      Buffer.from(png),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/png",
        maximumSizeInBytes: maximumBrowserImageBytes,
        token: "vercel_blob_rw_test",
      })
    );
    expect(mocks.finalize).toHaveBeenCalledWith(
      scope,
      reservation,
      expect.objectContaining({
        byteSize: png.byteLength,
        contentHash: createHash("sha256").update(png).digest("hex"),
        filename: "product.png",
        mediaType: "image/png",
        storagePathname: `${reservation.storagePathname}/${createHash("sha256")
          .update(png)
          .digest("hex")}`,
      })
    );
  });

  it("rejects oversized responses before buffering them", async () => {
    const response = new Response("small", {
      headers: { "content-length": String(maximumBrowserImageBytes + 1) },
    });

    await expect(readBoundedResponse(response)).rejects.toThrow("exceeds the");
  });

  it("loads only the scoped root-session artifact and verifies its hash", async () => {
    mocks.readReady.mockResolvedValue({
      byteSize: png.byteLength,
      contentHash: createHash("sha256").update(png).digest("hex"),
      filename: "product.png",
      id: reservation.id,
      mediaType: "image/png",
      storagePathname: reservation.storagePathname,
    });
    mocks.get.mockResolvedValue({
      blob: {
        contentType: "image/png",
        etag: '"etag"',
        size: png.byteLength,
      },
      statusCode: 200,
      stream: new Response(png).body,
    });

    const result = await readBrowserImageBytes(scope, reservation.id, {
      rootSessionId: "root-session",
    });

    expect(mocks.readReady).toHaveBeenCalledWith(scope, reservation.id, {
      rootSessionId: "root-session",
    });
    expect(result).toEqual({
      bytes: png,
      filename: "product.png",
      id: reservation.id,
      mediaType: "image/png",
    });
  });

  it("rejects content whose bytes do not match the manifest", async () => {
    mocks.readReady.mockResolvedValue({
      byteSize: png.byteLength,
      contentHash: "not-the-hash",
      filename: "product.png",
      id: reservation.id,
      mediaType: "image/png",
      storagePathname: reservation.storagePathname,
    });
    mocks.get.mockResolvedValue({
      blob: {
        contentType: "image/png",
        etag: '"etag"',
        size: png.byteLength,
      },
      statusCode: 200,
      stream: new Response(png).body,
    });

    expect(await readBrowserImageBytes(scope, reservation.id)).toBeUndefined();
  });

  it("keeps the finalized winner and deletes a losing concurrent upload", async () => {
    const winnerPathname = `${reservation.storagePathname}/winner-hash`;
    mocks.finalize.mockResolvedValue({
      image: { id: reservation.id },
      storagePathname: winnerPathname,
    });

    await persistReservedBrowserImage(scope, reservation, {
      bytes: png,
      filename: "product.png",
      sourceKind: "viewport",
    });

    const losingPathname = `${reservation.storagePathname}/${createHash(
      "sha256"
    )
      .update(png)
      .digest("hex")}`;
    expect(mocks.del).toHaveBeenCalledWith(losingPathname, {
      token: "vercel_blob_rw_test",
    });
  });
});

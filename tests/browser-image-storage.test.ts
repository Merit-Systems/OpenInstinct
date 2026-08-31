/* oxlint-disable vitest/require-mock-type-parameters -- Hoisted Blob and database fakes are configured per test. */
import { createHash } from "node:crypto";
import type { get } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BrowserImageService from "@/db/services/browser-images";
import { maximumBrowserImageBytes } from "@/lib/browser-images";

import {
  browserImageBlobAuthentication,
  browserImageServerDependencies,
  persistReservedBrowserImage,
  readBoundedResponse,
  readBrowserImageBytes,
} from "@/lib/browser-images/server";

const delMock = vi.spyOn(browserImageServerDependencies, "del");
const getMock = vi.spyOn(browserImageServerDependencies, "get");
const putMock = vi.spyOn(browserImageServerDependencies, "put");
const finalizeMock = vi.spyOn(
  browserImageServerDependencies,
  "finalizeBrowserImageArtifact"
);
const readReadyMock = vi.spyOn(
  browserImageServerDependencies,
  "readReadyBrowserImageArtifact"
);
type BlobGetResult = NonNullable<Awaited<ReturnType<typeof get>>>;
type FinalizedArtifact = Awaited<
  ReturnType<typeof BrowserImageService.finalizeBrowserImageArtifact>
>;
type ReadyArtifact = NonNullable<
  Awaited<ReturnType<typeof BrowserImageService.readReadyBrowserImageArtifact>>
>;

function blobGetResult(): BlobGetResult {
  const stream = new Response(png).body;
  if (!stream) throw new Error("The test Response did not expose a body.");
  return {
    blob: {
      cacheControl: "private, max-age=3600",
      contentDisposition: 'inline; filename="product.png"',
      contentType: "image/png",
      downloadUrl: "https://blob.example/download",
      etag: '"etag"',
      pathname: reservation.storagePathname,
      size: png.byteLength,
      uploadedAt: new Date("2026-08-31T00:00:00.000Z"),
      url: "https://blob.example/image",
    },
    headers: new Headers(),
    statusCode: 200,
    stream,
  };
}

function readyArtifact(contentHash: string): ReadyArtifact {
  return {
    browserSessionId: "browser-1",
    byteSize: png.byteLength,
    contentHash,
    createdAt: "2026-08-31T00:00:00.000Z",
    createdByUserId: scope.userId,
    filename: "product.png",
    id: reservation.id,
    idempotencyKey: "image-call-1",
    label: "Product",
    mediaType: "image/png",
    rootSessionId: "root-session",
    sourceKind: "viewport",
    status: "ready",
    storagePathname: reservation.storagePathname,
    workerSessionId: "worker-1",
    workspaceId: scope.workspaceId,
  };
}

function finalizedArtifact(storagePathname: string): FinalizedArtifact {
  return {
    image: {
      byteSize: png.byteLength,
      filename: "product.png",
      id: reservation.id,
      label: "Product",
      mediaType: "image/png",
      url: `/artifacts/${reservation.id}`,
    },
    storagePathname,
  };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scope = { userId: "user-1", workspaceId: "workspace-1" };
const reservation = {
  id: "0d01e667-d128-4bb7-a248-1ae21db72f4f",
  storagePathname:
    "browser-images/workspace/0d01e667-d128-4bb7-a248-1ae21db72f4f",
};

beforeEach(() => {
  vi.clearAllMocks();
  delMock.mockResolvedValue(undefined);
  putMock.mockResolvedValue({
    contentDisposition: 'inline; filename="product.png"',
    contentType: "image/png",
    downloadUrl: "https://blob.example/download",
    etag: '"etag"',
    pathname: reservation.storagePathname,
    url: "https://blob.example/image",
  });
  finalizeMock.mockResolvedValue(
    finalizedArtifact(
      `${reservation.storagePathname}/${createHash("sha256")
        .update(png)
        .digest("hex")}`
    )
  );
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

    expect(putMock).toHaveBeenCalledWith(
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
    expect(finalizeMock).toHaveBeenCalledWith(
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
    readReadyMock.mockResolvedValue(
      readyArtifact(createHash("sha256").update(png).digest("hex"))
    );
    getMock.mockResolvedValue(blobGetResult());

    const result = await readBrowserImageBytes(scope, reservation.id, {
      rootSessionId: "root-session",
    });

    expect(readReadyMock).toHaveBeenCalledWith(scope, reservation.id, {
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
    readReadyMock.mockResolvedValue(readyArtifact("not-the-hash"));
    getMock.mockResolvedValue(blobGetResult());

    expect(await readBrowserImageBytes(scope, reservation.id)).toBeUndefined();
  });

  it("keeps the finalized winner and deletes a losing concurrent upload", async () => {
    const winnerPathname = `${reservation.storagePathname}/winner-hash`;
    finalizeMock.mockResolvedValue(finalizedArtifact(winnerPathname));

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
    expect(delMock).toHaveBeenCalledWith(losingPathname, {
      token: "vercel_blob_rw_test",
    });
  });
});

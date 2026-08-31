import { createHash } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import type { AccessScope } from "@/lib/access-scope";
import {
  finalizeBrowserImageArtifact,
  readReadyBrowserImageArtifact,
  type BrowserImageArtifactReservation,
} from "@/db/services/browser-images";
import {
  maximumBrowserImageBytes,
  sniffBrowserImageMediaType,
} from "@/lib/browser-images";
import { env } from "@/lib/env";

const blobOptions = { access: "private" as const };

export const browserImageServerDependencies = {
  del,
  finalizeBrowserImageArtifact,
  get,
  put,
  readReadyBrowserImageArtifact,
};

export function browserImageBlobAuthentication(input: {
  readonly readWriteToken?: string;
  readonly storeId?: string;
}) {
  if (input.storeId) return { storeId: input.storeId };
  if (input.readWriteToken) return { token: input.readWriteToken };
  throw new Error(
    "Browser image storage is not configured. Connect a private Vercel Blob store or set BLOB_READ_WRITE_TOKEN."
  );
}

function blobAuthentication() {
  return browserImageBlobAuthentication({
    readWriteToken: env.BLOB_READ_WRITE_TOKEN,
    storeId: env.BLOB_STORE_ID,
  });
}

export async function persistReservedBrowserImage(
  scope: AccessScope,
  reservation: BrowserImageArtifactReservation,
  input: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly sourceKind: string;
  },
  signal?: AbortSignal
) {
  if (input.bytes.byteLength === 0)
    throw new Error("The browser image is empty.");
  if (input.bytes.byteLength > maximumBrowserImageBytes) {
    throw new Error(
      `The browser image is ${String(input.bytes.byteLength)} bytes; the limit is ${String(maximumBrowserImageBytes)}.`
    );
  }
  const mediaType = sniffBrowserImageMediaType(input.bytes);
  if (!mediaType) {
    throw new Error("The captured resource is not a supported browser image.");
  }
  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  const attemptPathname = `${reservation.storagePathname}/${contentHash}`;

  await browserImageServerDependencies.put(
    attemptPathname,
    Buffer.from(input.bytes),
    {
      ...blobOptions,
      ...blobAuthentication(),
      abortSignal: signal,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 30 * 24 * 60 * 60,
      contentType: mediaType,
      maximumSizeInBytes: maximumBrowserImageBytes,
    }
  );

  try {
    const finalized =
      await browserImageServerDependencies.finalizeBrowserImageArtifact(
        scope,
        reservation,
        {
          byteSize: input.bytes.byteLength,
          contentHash,
          filename: input.filename,
          mediaType,
          sourceKind: input.sourceKind,
          storagePathname: attemptPathname,
        }
      );
    if (finalized.storagePathname !== attemptPathname) {
      await deleteBlob(attemptPathname);
    }
    return finalized.image;
  } catch (error) {
    await deleteBlob(attemptPathname);
    throw error;
  }
}

async function deleteBlob(pathname: string) {
  await browserImageServerDependencies
    .del(pathname, blobAuthentication())
    .catch(() => undefined);
}

export async function getBrowserImageBlob(
  scope: AccessScope,
  artifactId: string,
  options: {
    readonly ifNoneMatch?: string;
    readonly rootSessionId?: string;
    readonly signal?: AbortSignal;
  } = {}
) {
  const artifact =
    await browserImageServerDependencies.readReadyBrowserImageArtifact(
      scope,
      artifactId,
      { rootSessionId: options.rootSessionId }
    );
  if (!artifact) return undefined;
  const { byteSize, contentHash, filename, mediaType } = artifact;
  if (!byteSize || !contentHash || !filename || !mediaType) return undefined;
  const readyArtifact = {
    ...artifact,
    byteSize,
    contentHash,
    filename,
    mediaType,
  };
  const result = await browserImageServerDependencies.get(
    artifact.storagePathname,
    {
      ...blobOptions,
      ...blobAuthentication(),
      abortSignal: options.signal,
      ifNoneMatch: options.ifNoneMatch,
    }
  );
  if (!result) return undefined;
  if (
    result.statusCode === 200 &&
    (result.blob.size !== readyArtifact.byteSize ||
      result.blob.contentType !== readyArtifact.mediaType)
  ) {
    return undefined;
  }
  return { artifact: readyArtifact, result };
}

export async function readBrowserImageBytes(
  scope: AccessScope,
  artifactId: string,
  options: {
    readonly rootSessionId?: string;
    readonly signal?: AbortSignal;
  } = {}
) {
  const opened = await getBrowserImageBlob(scope, artifactId, options);
  if (opened?.result.statusCode !== 200) return undefined;
  const bytes = await readBoundedStream(
    opened.result.stream,
    maximumBrowserImageBytes
  );
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  if (contentHash !== opened.artifact.contentHash) return undefined;
  return {
    bytes,
    filename: opened.artifact.filename,
    id: opened.artifact.id,
    mediaType: opened.artifact.mediaType,
  };
}

export async function readBoundedResponse(
  response: Response,
  maximumBytes = maximumBrowserImageBytes
) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(
      `The browser image exceeds the ${String(maximumBytes)} byte limit.`
    );
  }
  if (!response.body) throw new Error("The browser image response is empty.");
  return readBoundedStream(response.body, maximumBytes);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(
          `The browser image exceeds the ${String(maximumBytes)} byte limit.`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import type { AccessScope } from "@/lib/access-scope";
import { readReadyBrowserImageArtifact } from "@/db/services/browser-images";
import { maximumBrowserImageBytes } from "@/lib/browser-artifact";
import { env } from "@/env";
import { maximumWorkerCompletionImages } from "@/lib/worker-completion";
import {
  extractBrowserImageMarkdownReferences,
  stripBrowserImageMarkdownReferences,
} from "./linq-browser-image-markdown";

interface LinqBrowserImageFile {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}

export async function prepareLinqBrowserImageDelivery(
  message: string,
  input: {
    readonly rootSessionId: string;
    readonly scope: AccessScope;
    readonly signal?: AbortSignal;
  }
) {
  const references = extractBrowserImageMarkdownReferences(message);
  if (references.length === 0) {
    return { failedArtifactIds: [], files: [], markdown: message };
  }

  const selected = references.slice(0, maximumWorkerCompletionImages);
  const loaded = await Promise.all(
    selected.map(async (reference) => ({
      image: await readLinqBrowserImage(input.scope, reference.id, {
        rootSessionId: input.rootSessionId,
        signal: input.signal,
      }).catch(() => undefined),
      reference,
    }))
  );
  const failedArtifactIds = [
    ...loaded
      .filter((item) => item.image === undefined)
      .map((item) => item.reference.id),
    ...references
      .slice(maximumWorkerCompletionImages)
      .map((reference) => reference.id),
  ];
  const files = loaded.flatMap(({ image }) =>
    image
      ? [
          {
            data: Buffer.from(image.bytes),
            filename: image.filename,
            mimeType: image.mediaType,
          } satisfies LinqBrowserImageFile,
        ]
      : []
  );

  return {
    failedArtifactIds,
    files,
    markdown: stripBrowserImageMarkdownReferences(message),
  };
}

async function readLinqBrowserImage(
  scope: AccessScope,
  artifactId: string,
  options: { readonly rootSessionId: string; readonly signal?: AbortSignal }
) {
  const artifact = await readReadyBrowserImageArtifact(scope, artifactId, {
    rootSessionId: options.rootSessionId,
  });
  if (
    !artifact?.byteSize ||
    !artifact.contentHash ||
    !artifact.filename ||
    !artifact.mediaType
  )
    return;
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) return;
  const result = await get(artifact.storagePathname, {
    access: "private",
    abortSignal: options.signal,
  });
  if (result?.statusCode !== 200) return;
  if (
    result.blob.size !== artifact.byteSize ||
    result.blob.contentType !== artifact.mediaType
  )
    return;
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBrowserImageBytes) return;
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
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash)
    return;
  return {
    bytes,
    filename: artifact.filename,
    id: artifact.id,
    mediaType: artifact.mediaType,
  };
}

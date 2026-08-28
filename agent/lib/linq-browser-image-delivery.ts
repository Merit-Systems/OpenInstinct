import type { AccessScope } from "@/lib/access-scope";
import {
  extractBrowserImageMarkdownReferences,
  maximumBrowserImagesPerCompletion,
  stripBrowserImageMarkdownReferences,
} from "@/lib/browser-images";
import { readBrowserImageBytes } from "@/lib/browser-images/server";

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

  const selected = references.slice(0, maximumBrowserImagesPerCompletion);
  const loaded = await Promise.all(
    selected.map(async (reference) => ({
      image: await readBrowserImageBytes(input.scope, reference.id, {
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
      .slice(maximumBrowserImagesPerCompletion)
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

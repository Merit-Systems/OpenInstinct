import type { AccessScope } from "@/lib/access-scope";
import { applicationOrigin } from "@/lib/application-origin";
import { parseArtifactMessage } from "@/lib/artifacts";
import { publishArtifactForSharing } from "@/lib/artifacts/server";
import { maximumWorkerCompletionImages } from "@/lib/worker-completion";

interface LinqArtifactAttachment {
  readonly name: string;
  readonly type: "image";
  readonly url: string;
}

const artifactPublicationTimeoutMs = 10_000;

export async function prepareLinqArtifactDelivery(
  message: string,
  input: {
    readonly scope: AccessScope;
    readonly signal?: AbortSignal;
  }
) {
  const segments = parseArtifactMessage(message);
  const references = segments.filter((segment) => segment.type === "artifact");
  if (references.length === 0) {
    return { attachments: [], failedArtifactIds: [], markdown: message };
  }

  const timeoutSignal = AbortSignal.timeout(artifactPublicationTimeoutMs);
  const publicationSignal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  const loaded = await Promise.all(
    references.map(async (reference) => ({
      artifact: await publishArtifactForSharing(
        input.scope,
        reference.id,
        publicationSignal
      ).catch(() => undefined),
      reference,
    }))
  );
  const imageArtifacts = loaded.flatMap((item) => {
    const artifact = item.artifact;
    return artifact?.kind === "image" && artifact.sourceUrl
      ? [
          {
            id: item.reference.id,
            sourceUrl: artifact.sourceUrl,
            title: artifact.title,
          },
        ]
      : [];
  });
  const selected = imageArtifacts.slice(0, maximumWorkerCompletionImages);
  const attachments = selected.map((artifact): LinqArtifactAttachment => ({
    name: artifact.title,
    type: "image",
    url: artifact.sourceUrl,
  }));
  const failedArtifactIds = [
    ...loaded
      .filter((item) => item.artifact === undefined)
      .map((item) => item.reference.id),
    ...imageArtifacts
      .slice(maximumWorkerCompletionImages)
      .map((item) => item.id),
  ];
  const publishedArtifactIds = new Set(
    loaded.flatMap((item) => (item.artifact ? [item.reference.id] : []))
  );
  const origin = applicationOrigin();
  const markdown = segments
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : publishedArtifactIds.has(segment.id)
          ? new URL(segment.url, origin).toString()
          : ""
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return { attachments, failedArtifactIds, markdown };
}

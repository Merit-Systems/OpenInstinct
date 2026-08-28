import { z } from "zod";
import {
  browserImageArtifactIdSource,
  browserImageArtifactPathPattern,
} from "./browser-image-path";

export const maximumBrowserImageBytes = 8 * 1024 * 1024;
export const maximumBrowserImagesPerCompletion = 4;

export const browserImageMediaTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const browserImageSourceKindSchema = z.enum([
  "element",
  "full_page",
  "image_resource",
  "viewport",
]);

const artifactMarkdownPattern = new RegExp(
  String.raw`!\[((?:\\.|[^\]])*)\]\((/artifacts/(${browserImageArtifactIdSource}))\)`,
  "giu"
);

export const browserImageArtifactReferenceSchema = z
  .object({
    byteSize: z.number().int().positive().max(maximumBrowserImageBytes),
    filename: z.string().trim().min(1).max(180),
    id: z.uuid(),
    label: z.string().trim().min(1).max(200),
    mediaType: browserImageMediaTypeSchema,
    url: z.string().regex(browserImageArtifactPathPattern),
  })
  .refine((artifact) => artifact.url === browserImageArtifactUrl(artifact.id), {
    message: "Artifact URL must match its id.",
    path: ["url"],
  });

export type BrowserImageArtifactReference = z.infer<
  typeof browserImageArtifactReferenceSchema
>;

interface BrowserImageMarkdownReference {
  readonly id: string;
  readonly label: string;
  readonly markdown: string;
  readonly url: string;
}

export function browserImageArtifactUrl(id: string) {
  return `/artifacts/${encodeURIComponent(z.uuid().parse(id))}`;
}

export function browserImageMarkdown(artifact: BrowserImageArtifactReference) {
  const label = artifact.label
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  return `![${label}](${artifact.url})`;
}

export function extractBrowserImageMarkdownReferences(message: string) {
  const references: BrowserImageMarkdownReference[] = [];
  const seen = new Set<string>();

  for (const match of message.matchAll(artifactMarkdownPattern)) {
    const [markdown, label, url, id] = match;
    if (!url || !id || seen.has(id)) continue;
    seen.add(id);
    references.push({ id, label: label ?? "", markdown, url });
  }

  return references;
}

export function stripBrowserImageMarkdownReferences(message: string) {
  return message
    .replace(artifactMarkdownPattern, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function safeBrowserImageFilename(label: string, mediaType: string) {
  const extension = browserImageExtension(mediaType);
  const withoutControls = label
    .normalize("NFKD")
    .replace(/(?:\.\.[/\\])+/gu, "")
    .replace(/\p{Cc}+/gu, "");
  const stem = withoutControls
    .replace(/[^\p{L}\p{N}._() -]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\.+|\.+$/gu, "")
    .slice(0, 160);
  return `${stem || "browser-image"}.${extension}`;
}

function browserImageExtension(mediaType: string) {
  switch (browserImageMediaTypeSchema.parse(mediaType)) {
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

export function sniffBrowserImageMediaType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png" as const;
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg" as const;
  }
  if (bytes.length >= 6) {
    const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif" as const;
    }
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder("ascii").decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp" as const;
  }
  return undefined;
}

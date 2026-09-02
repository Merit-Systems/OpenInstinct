import { createHash, randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { artifactIdSchema, artifactMarker, artifactUrl } from "@/lib/artifacts";

const maximumHtmlCharacters = 250_000;
const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Artifact URLs must use HTTPS.",
  });

export const publishArtifactInputSchema = z.discriminatedUnion("kind", [
  z.object({
    description: z.string().trim().max(500).optional(),
    html: z.string().min(1).max(maximumHtmlCharacters),
    kind: z.literal("html"),
    title: z.string().trim().min(1).max(120),
  }),
  z.object({
    description: z.string().trim().max(500).optional(),
    kind: z.enum(["audio", "file", "image", "pdf", "url", "video"]),
    sourceUrl: httpsUrlSchema,
    title: z.string().trim().min(1).max(120),
  }),
]);

const artifactManifestSchema = z.object({
  createdAt: z.iso.datetime(),
  description: z.string().max(500).optional(),
  html: z.string().max(maximumHtmlCharacters).optional(),
  id: artifactIdSchema,
  kind: z.enum(["audio", "file", "html", "image", "pdf", "url", "video"]),
  sourceUrl: httpsUrlSchema.optional(),
  title: z.string().min(1).max(120),
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

const blobOptions = { access: "private" as const };

export async function publishArtifact(
  scope: AccessScope,
  input: z.input<typeof publishArtifactInputSchema>
) {
  const artifact = publishArtifactInputSchema.parse(input);
  const manifest = artifactManifestSchema.parse({
    ...artifact,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
  });
  const serialized = JSON.stringify(manifest);
  await put(artifactManifestPath(scope, manifest.id), serialized, {
    ...blobOptions,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    maximumSizeInBytes: 512 * 1024,
  });

  return {
    artifactMarker: artifactMarker(manifest.id),
    id: manifest.id,
    kind: manifest.kind,
    title: manifest.title,
    url: artifactUrl(manifest.id),
  };
}

export async function readArtifactManifest(
  scope: AccessScope,
  artifactId: string,
  signal?: AbortSignal
) {
  const id = artifactIdSchema.parse(artifactId);
  const result = await get(artifactManifestPath(scope, id), {
    ...blobOptions,
    abortSignal: signal,
  });
  if (result?.statusCode !== 200) return undefined;
  const serialized = await new Response(result.stream).text();
  if (serialized.length > 512 * 1024) return undefined;
  return artifactManifestSchema.parse(JSON.parse(serialized));
}

function artifactManifestPath(scope: AccessScope, artifactId: string) {
  const owner = createHash("sha256")
    .update(`${scope.workspaceId}\0${scope.userId}`)
    .digest("hex");
  return `artifacts/${owner}/${artifactId}/manifest.json`;
}

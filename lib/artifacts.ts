import { z } from "zod";

export const artifactIdSchema = z.uuid();

const artifactMarkerPattern =
  /\[\[artifact:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/giu;

export type ArtifactMessageSegment =
  | { readonly text: string; readonly type: "text" }
  | {
      readonly id: string;
      readonly type: "artifact";
      readonly url: string;
    };

export function artifactUrl(id: string) {
  return `/artifacts/${encodeURIComponent(artifactIdSchema.parse(id))}`;
}

export function artifactMarker(id: string) {
  return `[[artifact:${artifactIdSchema.parse(id)}]]`;
}

export function parseArtifactMessage(
  message: string
): ArtifactMessageSegment[] {
  const segments: ArtifactMessageSegment[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  for (const match of message.matchAll(artifactMarkerPattern)) {
    const index = match.index;
    const id = match[1];
    if (index === undefined || id === undefined) continue;

    appendText(segments, message.slice(cursor, index));
    if (!seen.has(id)) {
      seen.add(id);
      segments.push({ id, type: "artifact", url: artifactUrl(id) });
    }
    cursor = index + match[0].length;
  }

  appendText(segments, message.slice(cursor));
  return segments.length > 0 ? segments : [{ text: message, type: "text" }];
}

function appendText(segments: ArtifactMessageSegment[], text: string) {
  const normalized = text
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (normalized) segments.push({ text: normalized, type: "text" });
}

import { isBrowserImageArtifactUrl } from "@/lib/browser-artifact";

const browserImageMarkdownPattern =
  /!\[((?:\\.|[^\]])*)\]\((\/artifacts\/([^\s)]+))\)/giu;

export function extractBrowserImageMarkdownReferences(message: string) {
  const references: {
    readonly id: string;
    readonly label: string;
    readonly markdown: string;
    readonly url: string;
  }[] = [];
  const seen = new Set<string>();

  for (const match of message.matchAll(browserImageMarkdownPattern)) {
    const [markdown, label, url, id] = match;
    if (!markdown || !url || !id || seen.has(id)) continue;
    if (!isBrowserImageArtifactUrl(url)) continue;
    seen.add(id);
    references.push({ id, label: label ?? "", markdown, url });
  }

  return references;
}

export function stripBrowserImageMarkdownReferences(message: string) {
  return message
    .replace(browserImageMarkdownPattern, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

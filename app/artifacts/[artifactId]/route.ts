import { z } from "zod";
import { getAuthSession } from "@/auth/session";
import { accessScopeForUser } from "@/lib/access-scope";
import {
  type ArtifactManifest,
  readArtifactManifest,
} from "@/lib/artifacts/server";
import { getBrowserImageBlob } from "@/lib/browser-images/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext<"/artifacts/[artifactId]">
) {
  const session = await getAuthSession(request.headers);
  const parsedId = z.uuid().safeParse((await context.params).artifactId);
  if (!session || !parsedId.success) return notFound();

  const scope = accessScopeForUser(`better-auth:${session.user.id}`);
  const artifact = await readArtifactManifest(
    scope,
    parsedId.data,
    request.signal
  );
  if (artifact) return artifactResponse(artifact);

  const opened = await getBrowserImageBlob(scope, parsedId.data, {
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    signal: request.signal,
  });
  if (!opened) return notFound();

  const headers = privateImageHeaders();
  headers.set("etag", opened.result.blob.etag);
  if (opened.result.statusCode === 304) {
    return new Response(null, { headers, status: 304 });
  }

  headers.set("content-length", String(opened.artifact.byteSize));
  headers.set("content-type", opened.artifact.mediaType);
  headers.set(
    "content-disposition",
    contentDisposition(opened.artifact.filename)
  );
  return new Response(opened.result.stream, { headers, status: 200 });
}

function artifactResponse(artifact: ArtifactManifest) {
  const headers = artifactHeaders();
  if (artifact.kind === "html" && artifact.html !== undefined) {
    return new Response(artifact.html, { headers, status: 200 });
  }
  return new Response(artifactShell(artifact), { headers, status: 200 });
}

function artifactShell(artifact: ArtifactManifest) {
  const title = escapeHtml(artifact.title);
  const description = artifact.description
    ? `<p>${escapeHtml(artifact.description)}</p>`
    : "";
  const sourceUrl = escapeHtml(artifact.sourceUrl ?? "");
  const content = artifactContent(artifact.kind, sourceUrl, title);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0b0d0f;color:#f4f4f5;padding:24px}main{width:min(100%,960px);margin:auto}header{margin-bottom:18px}h1{font-size:clamp(1.3rem,4vw,2rem);margin:0 0 8px}p{color:#a1a1aa;margin:0;line-height:1.5}.surface{overflow:hidden;border:1px solid #2b2f35;border-radius:16px;background:#14171b;min-height:180px;display:grid;place-items:center}.surface img,.surface video,.surface iframe{display:block;width:100%;max-height:72vh;border:0;object-fit:contain}.surface audio{width:min(90%,640px)}a.button{display:inline-flex;padding:11px 16px;border-radius:10px;background:#f4f4f5;color:#111;text-decoration:none;font-weight:650}.open{margin-top:14px;color:#a1a1aa;font-size:.85rem}.open a{color:inherit}</style></head>
<body><main><header><h1>${title}</h1>${description}</header><section class="surface">${content}</section><div class="open"><a href="${sourceUrl}" rel="noreferrer" target="_blank">Open source in a new tab</a></div></main></body></html>`;
}

function artifactContent(
  kind: ArtifactManifest["kind"],
  url: string,
  title: string
) {
  switch (kind) {
    case "image":
      return `<img alt="${title}" src="${url}">`;
    case "audio":
      return `<audio controls src="${url}"></audio>`;
    case "video":
      return `<video controls playsinline src="${url}"></video>`;
    case "pdf":
      return `<iframe src="${url}" title="${title}"></iframe>`;
    case "url":
      return `<a class="button" href="${url}" rel="noreferrer" target="_blank">Open ${title}</a>`;
    case "file":
      return `<a class="button" download href="${url}" rel="noreferrer" target="_blank">Download ${title}</a>`;
    case "html":
      return "";
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function notFound() {
  return new Response("Not found", {
    headers: privateImageHeaders(),
    status: 404,
  });
}

function privateImageHeaders() {
  return new Headers({
    "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function artifactHeaders() {
  return new Headers({
    "cache-control": "private, no-store",
    "content-security-policy":
      "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src 'none'; img-src data: https:; media-src data: https:; frame-src https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline' https:; connect-src https:; form-action https:",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

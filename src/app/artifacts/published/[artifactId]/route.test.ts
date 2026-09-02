import { describe, expect, it, vi } from "vitest";
import type { ArtifactManifest } from "@/lib/artifacts/server";

const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const mocks = vi.hoisted(() => ({
  readPublishedArtifactManifest:
    vi.fn<
      (
        artifactId: string,
        signal?: AbortSignal
      ) => Promise<ArtifactManifest | undefined>
    >(),
}));

vi.mock("@/lib/artifacts/server", () => ({
  readPublishedArtifactManifest: mocks.readPublishedArtifactManifest,
}));

import { GET } from "./route";

describe("public artifact route", () => {
  it("serves image artifacts without a login and includes preview metadata", async () => {
    mocks.readPublishedArtifactManifest.mockResolvedValue({
      createdAt: "2026-09-01T00:00:00.000Z",
      description: "A generated image",
      id: artifactId,
      kind: "image",
      sourceUrl: "https://images.example/result.png",
      title: "Result",
    });

    const response = await GET(
      new Request(
        `https://openinstinct.example/artifacts/published/${artifactId}`
      ),
      { params: Promise.resolve({ artifactId }) }
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(html).toContain('<meta property="og:title" content="Result">');
    expect(html).toContain(
      '<meta property="og:image" content="https://images.example/result.png">'
    );
    expect(html).toContain(
      `<meta property="og:url" content="https://openinstinct.example/artifacts/published/${artifactId}">`
    );
    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  it("does not cache invalid or unavailable capability URLs", async () => {
    mocks.readPublishedArtifactManifest.mockResolvedValue(undefined);

    const missing = await GET(
      new Request(
        `https://openinstinct.example/artifacts/published/${artifactId}`
      ),
      { params: Promise.resolve({ artifactId }) }
    );
    const invalid = await GET(
      new Request("https://openinstinct.example/artifacts/published/invalid"),
      { params: Promise.resolve({ artifactId: "invalid" }) }
    );

    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
  });

  it("injects metadata literally when artifact text contains replacement tokens", async () => {
    mocks.readPublishedArtifactManifest.mockResolvedValue({
      createdAt: "2026-09-01T00:00:00.000Z",
      html: "<!doctype html><html><head><title>Original</title></head><body>Body</body></html>",
      id: artifactId,
      kind: "html",
      title: "Budget $& and $' preview",
    });

    const response = await GET(
      new Request(
        `https://openinstinct.example/artifacts/published/${artifactId}`
      ),
      { params: Promise.resolve({ artifactId }) }
    );
    const html = await response.text();

    expect(html).toContain(
      '<meta property="og:title" content="Budget $&amp; and $&#39; preview">'
    );
    expect(html.match(/<body>Body<\/body>/gu)).toHaveLength(1);
  });
});

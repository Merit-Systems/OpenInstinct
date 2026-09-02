/* oxlint-disable vitest/require-mock-type-parameters -- The Blob mock implements the publication operations exercised here. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  blobs: new Map<string, string>(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: mocks.get,
  put: mocks.put,
}));

import {
  publishArtifact,
  publishArtifactForSharing,
  readPublishedArtifactManifest,
} from "../artifacts/server";

const scope = { userId: "user-1", workspaceId: "workspace-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.blobs.clear();
  mocks.put.mockImplementation(async (pathname: string, body: string) => {
    mocks.blobs.set(pathname, body);
    return { pathname };
  });
  mocks.get.mockImplementation(async (pathname: string) => {
    const body = mocks.blobs.get(pathname);
    if (!body) return null;
    return {
      blob: { contentType: "application/json", size: body.length },
      statusCode: 200,
      stream: new Response(body).body,
    };
  });
});

describe("published artifacts", () => {
  it("creates a capability-addressed manifest that can be read without owner scope", async () => {
    const published = await publishArtifact(scope, {
      description: "A generated image",
      kind: "image",
      sourceUrl: "https://images.example/result.png",
      title: "Result",
    });

    expect(
      [...mocks.blobs.keys()].some(
        (pathname) =>
          pathname === `published-artifacts/${published.id}/manifest.json`
      )
    ).toBe(true);
    await expect(
      readPublishedArtifactManifest(published.id)
    ).resolves.toMatchObject({
      id: published.id,
      kind: "image",
      sourceUrl: "https://images.example/result.png",
      title: "Result",
    });
  });

  it("publishes an owner-scoped legacy manifest when it is shared", async () => {
    const artifactId = "aa899f61-f63c-49f0-96b1-fea3c2eb8419";
    const controller = new AbortController();
    const owner = createHash("sha256")
      .update(`${scope.workspaceId}\0${scope.userId}`)
      .digest("hex");
    mocks.blobs.set(
      `artifacts/${owner}/${artifactId}/manifest.json`,
      JSON.stringify({
        createdAt: "2026-09-01T00:00:00.000Z",
        id: artifactId,
        kind: "image",
        sourceUrl: "https://images.example/legacy.png",
        title: "Legacy result",
      })
    );

    await expect(
      publishArtifactForSharing(scope, artifactId, controller.signal)
    ).resolves.toMatchObject({ id: artifactId });
    expect(mocks.put).toHaveBeenLastCalledWith(
      `published-artifacts/${artifactId}/manifest.json`,
      expect.any(String),
      expect.objectContaining({ abortSignal: controller.signal })
    );
    await expect(
      readPublishedArtifactManifest(artifactId)
    ).resolves.toMatchObject({
      id: artifactId,
      sourceUrl: "https://images.example/legacy.png",
    });
  });

  it("does not publish a manifest outside its owner scope", async () => {
    await expect(
      publishArtifactForSharing(
        { userId: "other-user", workspaceId: scope.workspaceId },
        "aa899f61-f63c-49f0-96b1-fea3c2eb8419"
      )
    ).resolves.toBeUndefined();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("does not overwrite an artifact that is already public", async () => {
    const published = await publishArtifact(scope, {
      kind: "image",
      sourceUrl: "https://images.example/result.png",
      title: "Result",
    });
    mocks.put.mockClear();

    await expect(
      publishArtifactForSharing(scope, published.id)
    ).resolves.toMatchObject({ id: published.id });
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

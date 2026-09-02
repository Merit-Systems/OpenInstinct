/* oxlint-disable vitest/require-mock-type-parameters -- The Blob mock implements the publication operations exercised here. */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

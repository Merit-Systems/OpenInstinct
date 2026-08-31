/* oxlint-disable vitest/require-mock-type-parameters -- The hoisted storage fake is configured per test. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as BrowserImageServer from "@/lib/browser-images/server";
import { prepareLinqBrowserImageDelivery } from "../agent/lib/linq-browser-image-delivery";

const firstId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const secondId = "206c3a7e-c0b8-4317-9e34-552cff646673";
const readImageMock = vi.spyOn(BrowserImageServer, "readBrowserImageBytes");

const scope = { userId: "user-1", workspaceId: "workspace-1" };

beforeEach(() => {
  vi.clearAllMocks();
  readImageMock.mockImplementation(async (_scope, id) =>
    id === firstId
      ? {
          bytes: new Uint8Array([1, 2, 3]),
          filename: "product.png",
          id,
          mediaType: "image/png",
        }
      : undefined
  );
});

describe("Linq browser image delivery", () => {
  it("loads scoped artifacts, deduplicates references, and strips internal URLs", async () => {
    const markdown = [
      "Here is the product.",
      `![Product](/artifacts/${firstId})`,
      `![Product again](/artifacts/${firstId})`,
    ].join("\n\n");

    const result = await prepareLinqBrowserImageDelivery(markdown, {
      rootSessionId: "root-session",
      scope,
    });

    expect(readImageMock).toHaveBeenCalledExactlyOnceWith(scope, firstId, {
      rootSessionId: "root-session",
      signal: undefined,
    });
    expect(result.markdown).toBe("Here is the product.");
    expect(result.files).toEqual([
      {
        data: Buffer.from([1, 2, 3]),
        filename: "product.png",
        mimeType: "image/png",
      },
    ]);
    expect(result.failedArtifactIds).toEqual([]);
  });

  it("keeps successful files while reporting unavailable artifacts", async () => {
    const result = await prepareLinqBrowserImageDelivery(
      [
        `![First](/artifacts/${firstId})`,
        `![Second](/artifacts/${secondId})`,
      ].join("\n"),
      { rootSessionId: "root-session", scope }
    );

    expect(result.files).toHaveLength(1);
    expect(result.failedArtifactIds).toEqual([secondId]);
    expect(result.markdown).toBe("");
  });

  it("leaves ordinary markdown untouched without storage reads", async () => {
    const markdown = "See ![external](https://example.com/product.png).";

    const result = await prepareLinqBrowserImageDelivery(markdown, {
      rootSessionId: "root-session",
      scope,
    });

    expect(result).toEqual({
      failedArtifactIds: [],
      files: [],
      markdown,
    });
    expect(readImageMock).not.toHaveBeenCalled();
  });
});

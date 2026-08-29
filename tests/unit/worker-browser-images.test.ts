/* oxlint-disable typescript/no-unsafe-type-assertion, vitest/require-mock-type-parameters -- Eve owns the tool context and Vitest owns these hoisted provider fakes. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const artifactId = "0d01e667-d128-4bb7-a248-1ae21db72f4f";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = {
  byteSize: png.byteLength,
  filename: "Product.png",
  id: artifactId,
  label: "Product",
  mediaType: "image/png" as const,
  url: `/artifacts/${artifactId}`,
};

const mocks = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
  deleteFile: vi.fn(),
  fetch: vi.fn(),
  mask: vi.fn(),
  persist: vi.fn(),
  playwrightExecute: vi.fn(),
  readBoundedResponse: vi.fn(),
  readFile: vi.fn(),
  reserve: vi.fn(),
  retrieve: vi.fn(),
  requireOwnedBrowserSession: vi.fn(),
  requireWorkerScope: vi.fn(),
}));

vi.mock("@/agent/subagents/worker/lib/access", () => ({
  requireWorkerScope: mocks.requireWorkerScope,
}));
vi.mock("@/agent/subagents/worker/lib/owned-browser", () => ({
  requireOwnedBrowserSession: mocks.requireOwnedBrowserSession,
}));
vi.mock("@/agent/subagents/worker/lib/vault-screenshot-mask", () => ({
  withVaultScreenshotMask: mocks.mask,
}));
vi.mock("@/db/services/browser-images", () => ({
  reserveBrowserImageArtifact: mocks.reserve,
}));
vi.mock("@/lib/browser-images/server", () => ({
  persistReservedBrowserImage: mocks.persist,
  readBoundedResponse: mocks.readBoundedResponse,
}));
vi.mock("@/lib/kernel", () => ({
  kernel: {
    browsers: {
      computer: { captureScreenshot: mocks.captureScreenshot },
      fetch: mocks.fetch,
      fs: { deleteFile: mocks.deleteFile, readFile: mocks.readFile },
      playwright: { execute: mocks.playwrightExecute },
      retrieve: mocks.retrieve,
    },
  },
}));

import captureBrowserImage from "../../agent/subagents/worker/tools/capture_browser_image";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const reservation = {
  id: artifactId,
  storagePathname: `browser-images/workspace/${artifactId}`,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue(scope);
  mocks.requireOwnedBrowserSession.mockResolvedValue({
    sessionId: "browser-1",
  });
  mocks.reserve.mockResolvedValue({ reservation, status: "pending" });
  mocks.persist.mockResolvedValue(image);
  mocks.mask.mockImplementation(
    async (_sessionId: string, _signal: AbortSignal, capture: () => unknown) =>
      capture()
  );
  mocks.captureScreenshot.mockResolvedValue(new Response(png));
  mocks.readBoundedResponse.mockResolvedValue(png);
  mocks.playwrightExecute.mockResolvedValue({ result: true, success: true });
  mocks.readFile.mockResolvedValue(new Response(png));
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.retrieve.mockResolvedValue({ session_id: "browser-1" });
  mocks.fetch.mockResolvedValue(
    new Response(png, { headers: { "content-type": "image/png" } })
  );
});

describe("capture_browser_image", () => {
  it("captures a masked viewport and returns only the artifact descriptor", async () => {
    const result = await captureBrowserImage.execute(
      {
        label: "Product",
        region: { height: 200, width: 300, x: 10, y: 20 },
        session_id: "browser-1",
        source: "viewport",
      },
      context() as never
    );

    expect(mocks.requireWorkerScope).toHaveBeenCalledOnce();
    expect(mocks.requireOwnedBrowserSession).toHaveBeenCalledWith(
      scope,
      "browser-1"
    );
    expect(mocks.mask).toHaveBeenCalledOnce();
    expect(mocks.captureScreenshot).toHaveBeenCalledWith(
      "browser-1",
      { region: { height: 200, width: 300, x: 10, y: 20 } },
      { signal: undefined }
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      scope,
      reservation,
      expect.objectContaining({ sourceKind: "viewport" }),
      undefined
    );
    expect(result).toEqual({ image });
    expect(JSON.stringify(result)).not.toContain("base64");
  });

  it.each([
    ["full_page", undefined, "fullPage: true"],
    ["element", "#landingImage", "#landingImage"],
  ] as const)(
    "captures a Playwright %s screenshot",
    async (source, selector, code) => {
      await captureBrowserImage.execute(
        {
          label: "Product",
          session_id: "browser-1",
          source,
          ...(selector ? { selector } : {}),
        } as never,
        context() as never
      );

      expect(JSON.stringify(mocks.playwrightExecute.mock.calls)).toContain(
        code
      );
      expect(mocks.readFile).toHaveBeenCalledOnce();
      expect(mocks.deleteFile).toHaveBeenCalledOnce();
    }
  );

  it("fetches an image element's original resource through the browser", async () => {
    mocks.playwrightExecute.mockResolvedValue({
      result: { url: "https://images.example/product.png?private=ignored" },
      success: true,
    });

    await captureBrowserImage.execute(
      {
        label: "Product",
        selector: "#landingImage",
        session_id: "browser-1",
        source: "image_resource",
      },
      context() as never
    );

    expect(mocks.retrieve).toHaveBeenCalledWith(
      "browser-1",
      {},
      { signal: undefined }
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "browser-1",
      new URL("https://images.example/product.png?private=ignored"),
      expect.objectContaining({ method: "GET", timeout_ms: 20_000 })
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      scope,
      reservation,
      expect.objectContaining({ sourceKind: "image_resource" }),
      undefined
    );
    expect(JSON.stringify(mocks.persist.mock.calls)).not.toContain(
      "private=ignored"
    );
  });

  it("falls back to an element screenshot when the resource cannot be fetched", async () => {
    mocks.playwrightExecute
      .mockResolvedValueOnce({
        result: { url: "https://images.example/product.avif" },
        success: true,
      })
      .mockResolvedValueOnce({ result: true, success: true });
    mocks.fetch.mockResolvedValue(new Response("blocked", { status: 403 }));

    await captureBrowserImage.execute(
      {
        label: "Product",
        selector: "#landingImage",
        session_id: "browser-1",
        source: "image_resource",
      },
      context() as never
    );

    expect(mocks.readFile).toHaveBeenCalledOnce();
    expect(mocks.persist).toHaveBeenCalledWith(
      scope,
      reservation,
      expect.objectContaining({ sourceKind: "element" }),
      undefined
    );
  });

  it("reuses a ready idempotent artifact without another capture", async () => {
    mocks.reserve.mockResolvedValue({ image, status: "ready" });

    const result = await captureBrowserImage.execute(
      {
        label: "Product",
        session_id: "browser-1",
        source: "viewport",
      },
      context() as never
    );

    expect(result).toEqual({ image });
    expect(mocks.captureScreenshot).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("leaves a shared pending reservation available when capture fails", async () => {
    mocks.captureScreenshot.mockRejectedValue(new Error("Kernel failed"));

    await expect(
      captureBrowserImage.execute(
        {
          label: "Product",
          session_id: "browser-1",
          source: "viewport",
        },
        context() as never
      )
    ).rejects.toThrow("Kernel failed");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("deletes a temporary screenshot without reusing an aborted signal", async () => {
    const controller = new AbortController();
    mocks.readFile.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("Capture cancelled"));
    });

    await expect(
      captureBrowserImage.execute(
        {
          label: "Product",
          session_id: "browser-1",
          source: "full_page",
        },
        context(controller.signal) as never
      )
    ).rejects.toThrow("Capture cancelled");
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.deleteFile.mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(mocks.deleteFile.mock.calls[0]?.[1])).toContain(
      "/tmp/"
    );
  });
});

function context(abortSignal?: AbortSignal) {
  return {
    abortSignal,
    callId: "call-image",
    session: {
      id: "worker-session",
      parent: { rootSessionId: "root-session" },
    },
  };
}

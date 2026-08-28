import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessScope } from "../lib/access-scope";

const mocks = vi.hoisted(() => ({
  create: vi.fn<
    () => Promise<{
      created_at: string;
      deleted_at: null;
      session_id: string;
      viewport: { height: number; width: number };
    }>
  >(),
  createBrowserSession: vi.fn<() => Promise<void>>(),
  deleteByID: vi.fn<() => Promise<void>>(),
  extensionGet:
    vi.fn<
      (
        name: string,
        options: { signal?: AbortSignal }
      ) => Promise<{ id: string; name: string }>
    >(),
  playwrightExecute:
    vi.fn<
      (
        sessionId: string,
        input: { code: string; timeout_sec: number },
        options: { signal?: AbortSignal }
      ) => Promise<{ success: true }>
    >(),
  post: vi.fn<
    (
      path: string,
      options: {
        body: FormData;
        headers: { Accept: string };
        signal?: AbortSignal;
      }
    ) => Promise<void>
  >(),
  readFile: vi.fn<() => Promise<Buffer>>(),
  readdir: vi.fn<() => Promise<string[]>>(),
}));

vi.mock("@onkernel/sdk", () => ({
  default: class {
    readonly extensions = { get: mocks.extensionGet };
    readonly browsers = {
      create: mocks.create,
      deleteByID: mocks.deleteByID,
      playwright: { execute: mocks.playwrightExecute },
    };
    readonly post = mocks.post;
  },
}));

vi.mock("@/db/services/browsers", () => ({
  createBrowserSession: mocks.createBrowserSession,
  deleteBrowserSession: vi.fn<() => Promise<void>>(),
  listBrowserSessions: vi.fn<() => Promise<never[]>>(),
  readBrowserSession: vi.fn<() => Promise<undefined>>(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  readdir: mocks.readdir,
}));

import { manageOwnedKernelBrowsers } from "../agent/extensions/kernel/browser-runtime";

const scope: AccessScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    created_at: "2026-08-27T00:00:00.000Z",
    deleted_at: null,
    session_id: "browser-1",
    viewport: { height: 768, width: 1024 },
  });
  mocks.createBrowserSession.mockResolvedValue();
  mocks.deleteByID.mockResolvedValue();
  mocks.extensionGet.mockResolvedValue({
    id: "extension-1",
    name: "vault-autofill",
  });
  mocks.playwrightExecute.mockResolvedValue({ success: true });
  mocks.post.mockResolvedValue();
  mocks.readFile.mockResolvedValue(Buffer.from("extension archive"));
  mocks.readdir.mockResolvedValue(["local-vault-assistant-0.0.0-chrome.zip"]);
});

describe("per-session Kernel extension upload", () => {
  it("loads the packaged extension before navigating", async () => {
    await manageOwnedKernelBrowsers(scope, {
      action: "create",
      start_url: "https://example.com",
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: undefined,
        start_url: undefined,
      }),
      { signal: undefined }
    );
    expect(mocks.post).toHaveBeenCalledWith(
      "/browsers/browser-1/extensions",
      expect.objectContaining({
        headers: { Accept: "*/*" },
        signal: undefined,
      })
    );
    const request = mocks.post.mock.calls[0]?.[1] as
      | { body: FormData }
      | undefined;
    const entries = [...(request?.body.entries() ?? [])];
    expect(entries.map(([name]) => name)).toEqual([
      "extensions[0].name",
      "extensions[0].zip_file",
    ]);
    expect(entries[0]?.[1]).toBe("vault-autofill");
    const uploadedFile = entries[1]?.[1];
    expect(uploadedFile).toBeInstanceOf(File);
    if (!(uploadedFile instanceof File)) {
      throw new Error("Expected an uploaded extension file.");
    }
    expect(uploadedFile.name).toBe("vault-autofill.zip");
    const navigation = mocks.playwrightExecute.mock.calls[0];
    expect(navigation?.[0]).toBe("browser-1");
    expect(navigation?.[1].code).toContain('page.goto("https://example.com"');
    expect(navigation?.[1].timeout_sec).toBe(30);
    expect(navigation?.[2]).toEqual({ signal: undefined });
  });

  it("uses the stored extension fallback when no package is present", async () => {
    const missingDirectory = Object.assign(new Error("missing"), {
      code: "ENOENT",
    });
    mocks.readdir.mockRejectedValueOnce(missingDirectory);

    await manageOwnedKernelBrowsers(scope, {
      action: "create",
      start_url: "https://example.com",
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: [{ id: "extension-1" }],
        start_url: "https://example.com",
      }),
      { signal: undefined }
    );
    expect(mocks.extensionGet).toHaveBeenCalledWith("vault-autofill", {
      signal: undefined,
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("deletes a new browser when extension loading fails", async () => {
    mocks.post.mockRejectedValueOnce(new Error("upload failed"));

    await expect(
      manageOwnedKernelBrowsers(scope, { action: "create" })
    ).rejects.toThrow("upload failed");

    expect(mocks.createBrowserSession).not.toHaveBeenCalled();
    expect(mocks.deleteByID).toHaveBeenCalledWith("browser-1", {
      signal: undefined,
    });
  });
});

import type { requireRequestScope } from "@web/auth/request-scope";
import type { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "../page";

const mocks = vi.hoisted(() => ({
  scope: vi.fn<typeof requireRequestScope>(),
  mode: vi.fn<typeof knowledgeMemoryModeForWorkspace>(),
}));
vi.mock("@web/auth/request-scope", () => ({
  requireRequestScope: mocks.scope,
}));
vi.mock("@shared/memory/config", () => ({
  knowledgeMemoryModeForWorkspace: mocks.mode,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("../_components/memory-browser", () => ({
  MemoryBrowser: ({ mode }: { readonly mode: string }) =>
    createElement("p", null, mode),
}));

describe("memory page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ userId: "user", workspaceId: "workspace" });
    mocks.mode.mockReturnValue("off");
  });

  it("does not render when memory is disabled for this workspace", async () => {
    await expect(Page()).rejects.toThrow("not found");
    expect(mocks.mode).toHaveBeenCalledWith("workspace");
  });

  it("requires authentication before checking rollout", async () => {
    mocks.scope.mockRejectedValue(new Error("Sign in to continue."));
    await expect(Page()).rejects.toThrow("Sign in to continue.");
    expect(mocks.mode).not.toHaveBeenCalled();
  });

  it.each(["shadow", "enabled"] as const)(
    "passes %s mode to the browser",
    async (mode) => {
      mocks.mode.mockReturnValue(mode);
      expect(renderToStaticMarkup(await Page())).toContain(mode);
    }
  );
});
